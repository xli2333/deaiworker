import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import {
  SERVER_HEADERS_TIMEOUT_MS,
  SERVER_KEEP_ALIVE_TIMEOUT_MS,
  SERVER_REQUEST_TIMEOUT_MS,
  SERVER_SOCKET_TIMEOUT_MS,
} from './runtimeConfig.mjs';
import { cancelDeAiJob, createDeAiJob, getDeAiJob, validateGeminiApiKey } from './workflowService.mjs';

const ROOT_DIR = process.cwd();
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const HOST = process.env.BACKEND_HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8790);

const CONTENT_TYPE_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const ARTIFACT_CONTENT_TYPE_MAP = {
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

const resolveArtifactContentType = (filePath) =>
  ARTIFACT_CONTENT_TYPE_MAP[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store',
  });
  response.end(`${JSON.stringify(payload)}\n`);
};

const sendNoContent = (response) => {
  response.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  response.end();
};

const parseJsonBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    const wrapped = new Error(
      `请求 JSON 无法解析：${error instanceof Error ? error.message : String(error || 'Unknown JSON parse error')}`
    );
    wrapped.code = 'INVALID_REQUEST';
    throw wrapped;
  }
};

const resolveStatusCode = (error) => {
  switch (error?.code) {
    case 'INVALID_REQUEST':
      return 400;
    case 'JOB_NOT_FOUND':
      return 404;
    default:
      return 500;
  }
};

const serveStaticFile = async (requestPath, response) => {
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const candidatePath = path.resolve(DIST_DIR, relativePath);
  if (!candidatePath.startsWith(DIST_DIR)) {
    sendJson(response, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const stat = await fs.stat(candidatePath);
    const filePath = stat.isDirectory() ? path.join(candidatePath, 'index.html') : candidatePath;
    const buffer = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPE_MAP[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    response.end(buffer);
  } catch {
    if (requestPath !== '/' && !path.extname(requestPath)) {
      try {
        const indexHtml = await fs.readFile(path.join(DIST_DIR, 'index.html'));
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        response.end(indexHtml);
        return;
      } catch {
        // fall through
      }
    }
    sendJson(response, 404, { error: 'Not found' });
  }
};

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: 'Missing request URL.' });
    return;
  }

  if (request.method === 'OPTIONS') {
    sendNoContent(response);
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
  const pathname = url.pathname;

  try {
    if (request.method === 'GET' && pathname === '/api/health') {
      sendJson(response, 200, {
        ok: true,
        service: 'de_ai_worker',
        timeouts: {
          requestMs: SERVER_REQUEST_TIMEOUT_MS,
          headersMs: SERVER_HEADERS_TIMEOUT_MS,
          keepAliveMs: SERVER_KEEP_ALIVE_TIMEOUT_MS,
          socketMs: SERVER_SOCKET_TIMEOUT_MS,
        },
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/key/validate') {
      const body = await parseJsonBody(request);
      const result = await validateGeminiApiKey(body.apiKey);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === 'POST' && pathname === '/api/deai/jobs') {
      const body = await parseJsonBody(request);
      const job = await createDeAiJob(body || {});
      sendJson(response, 200, { job });
      return;
    }

    const jobMatch = pathname.match(/^\/api\/deai\/jobs\/([^/]+)$/);
    if (request.method === 'GET' && jobMatch) {
      const job = getDeAiJob(jobMatch[1]);
      sendJson(response, 200, { job });
      return;
    }

    const cancelMatch = pathname.match(/^\/api\/deai\/jobs\/([^/]+)\/cancel$/);
    if (request.method === 'POST' && cancelMatch) {
      const job = cancelDeAiJob(cancelMatch[1]);
      sendJson(response, 200, { job });
      return;
    }

    const artifactMatch = pathname.match(/^\/api\/deai\/jobs\/([^/]+)\/artifacts\/([^/]+)$/);
    if (request.method === 'GET' && artifactMatch) {
      const job = getDeAiJob(artifactMatch[1]);
      const requestedFile = decodeURIComponent(artifactMatch[2] || '');
      const safeFileName = path.basename(requestedFile);

      if (!safeFileName || safeFileName !== requestedFile || !job.result?.outputDir) {
        sendJson(response, 400, { error: 'Invalid artifact request.' });
        return;
      }

      const outputDir = path.resolve(job.result.outputDir);
      const filePath = path.resolve(outputDir, safeFileName);
      if (!filePath.startsWith(outputDir + path.sep) && filePath !== path.join(outputDir, safeFileName)) {
        sendJson(response, 403, { error: 'Forbidden' });
        return;
      }

      try {
        const buffer = await fs.readFile(filePath);
        response.writeHead(200, {
          'Content-Type': resolveArtifactContentType(filePath),
          'Content-Disposition': `attachment; filename="${safeFileName}"`,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        });
        response.end(buffer);
        return;
      } catch {
        sendJson(response, 404, { error: 'Artifact not found.' });
        return;
      }
    }

    await serveStaticFile(pathname, response);
  } catch (error) {
    sendJson(response, resolveStatusCode(error), {
      error: error instanceof Error ? error.message : String(error || 'Unknown server error'),
    });
  }
});

server.requestTimeout = SERVER_REQUEST_TIMEOUT_MS;
server.headersTimeout = SERVER_HEADERS_TIMEOUT_MS;
server.keepAliveTimeout = SERVER_KEEP_ALIVE_TIMEOUT_MS;
server.timeout = SERVER_SOCKET_TIMEOUT_MS;

server.listen(PORT, HOST, () => {
  console.log(`[de_ai_worker] listening on http://${HOST}:${PORT}`);
});
