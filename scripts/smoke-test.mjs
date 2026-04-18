import { SMOKE_TIMEOUT_MS } from '../server/runtimeConfig.mjs';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8790';
const API_KEY = String(process.env.SMOKE_API_KEY || process.env.GEMINI_API_KEY || 'mock-gemini').trim();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (input, init) => {
  const response = await fetch(input, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error || `${response.status} ${response.statusText}`));
  }
  return payload;
};

const fetchStatus = async (input, init) => {
  const response = await fetch(input, init);
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const run = async () => {
  const health = await fetchJson(`${BASE_URL}/api/health`);
  assert(health.ok === true, 'health 接口未返回 ok=true');
  assert(Number(health?.timeouts?.requestMs || 0) >= 20 * 60 * 1000, 'request timeout 未达到 20 分钟');
  assert(Number(health?.timeouts?.headersMs || 0) >= 20 * 60 * 1000, 'headers timeout 未达到 20 分钟');
  assert(Number(health?.timeouts?.socketMs || 0) >= 20 * 60 * 1000, 'socket timeout 未达到 20 分钟');
  console.log('[smoke] health ok');

  const missingJob = await fetchStatus(`${BASE_URL}/api/deai/jobs/not-found`);
  assert(missingJob.status === 404, '缺失任务未返回 404');
  console.log('[smoke] missing job 404 ok');

  const invalidCreate = await fetchStatus(`${BASE_URL}/api/deai/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { apiKey: API_KEY } }),
  });
  assert(invalidCreate.status === 400, '无文件创建请求未返回 400');
  console.log('[smoke] invalid request 400 ok');

  const keyValidation = await fetchJson(`${BASE_URL}/api/key/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: API_KEY }),
  });
  assert(keyValidation.ok === true, 'API Key 校验未通过');
  console.log('[smoke] key validation ok');

  const sampleText = [
    '# 示例文稿',
    '',
    '此外，这篇文章不仅仅是在讨论效率，而是在重新定义团队协作的底层逻辑。',
    '',
    '越来越多人意识到，AI 的价值并不只是自动化，而是全链路赋能。',
    '',
    '综上所述，这一变化值得每个人思考。',
  ].join('\n');

  const created = await fetchJson(`${BASE_URL}/api/deai/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: { apiKey: API_KEY },
      file: {
        name: 'smoke.md',
        mimeType: 'text/markdown',
        isText: true,
        data: sampleText,
      },
    }),
  });

  const jobId = created?.job?.id;
  assert(jobId, '任务创建失败，缺少 job id');
  console.log(`[smoke] job created: ${jobId}`);

  const startedAt = Date.now();
  while (Date.now() - startedAt < SMOKE_TIMEOUT_MS) {
    const current = await fetchJson(`${BASE_URL}/api/deai/jobs/${encodeURIComponent(jobId)}`);
    const job = current.job;
    console.log(`[smoke] polling: ${job.status} ${job.currentNode || ''} ${job.message || ''}`);
    if (job.status === 'succeeded') {
      assert(job.result?.finalText, '任务成功但缺少 finalText');
      console.log('[smoke] end-to-end ok');
      return;
    }
    if (job.status === 'failed' || job.status === 'canceled') {
      throw new Error(`任务未成功结束：${job.status} ${job.error || ''}`.trim());
    }
    await sleep(1500);
  }

  throw new Error('烟测轮询超时');
};

run().catch((error) => {
  console.error('[smoke] failed', error);
  process.exitCode = 1;
});
