import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT_DIR = process.cwd();
const MD2PDF_SCRIPT = path.join(ROOT_DIR, 'md2pdf.py');

const PYTHON_CANDIDATES =
  process.platform === 'win32'
    ? [
        ['python'],
        ['py', '-3'],
      ]
    : [
        ['python3'],
        ['python'],
      ];

const cleanText = (value = '') => String(value).trim();

const runCommand = async (command, args) =>
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          stdout: cleanText(stdout),
          stderr: cleanText(stderr),
        });
        return;
      }
      const error = new Error(cleanText(stderr) || cleanText(stdout) || `Command exited with code ${code}`);
      error.code = 'PDF_EXPORT_FAILED';
      reject(error);
    });
  });

export const exportMarkdownToPdf = async ({ markdownPath, pdfPath }) => {
  await fs.access(MD2PDF_SCRIPT);
  await fs.access(markdownPath);

  let lastError = null;

  for (const [command, ...baseArgs] of PYTHON_CANDIDATES) {
    try {
      const result = await runCommand(command, [...baseArgs, MD2PDF_SCRIPT, markdownPath, pdfPath]);
      return {
        ok: true,
        command: [command, ...baseArgs].join(' '),
        stdout: result.stdout,
        stderr: result.stderr,
        pdfPath,
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    pdfPath,
    error: lastError instanceof Error ? lastError.message : String(lastError || 'Unknown PDF export error'),
  };
};
