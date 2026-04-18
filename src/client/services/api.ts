import type { DeAiJob, UploadedFilePayload } from '../types';

const API_KEY_STORAGE_KEY = 'DE_AI_WORKER_GEMINI_API_KEY';
const POLL_INTERVAL_MS = 1200;
const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');

export const buildApiUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalizedPath}` : normalizedPath;
};

const resolveErrorMessage = async (response: Response) => {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return String(payload.error || `${response.status} ${response.statusText}`);
};

const fetchJson = async <T>(input: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(buildApiUrl(input), init);
  if (!response.ok) {
    throw new Error(await resolveErrorMessage(response));
  }
  return (await response.json()) as T;
};

export const getStoredApiKey = () => {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem(API_KEY_STORAGE_KEY)?.trim() || '';
};

export const setStoredApiKey = (apiKey: string) => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(API_KEY_STORAGE_KEY, apiKey.trim());
};

export const clearStoredApiKey = () => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(API_KEY_STORAGE_KEY);
};

export const validateApiKey = async (apiKey: string) =>
  await fetchJson<{ ok: boolean; model: string }>('/api/key/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });

export const createDeAiJob = async (apiKey: string, file: UploadedFilePayload) =>
  await fetchJson<{ job: DeAiJob }>('/api/deai/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: { apiKey },
      file,
    }),
  });

export const getDeAiJob = async (jobId: string) =>
  await fetchJson<{ job: DeAiJob }>(`/api/deai/jobs/${encodeURIComponent(jobId)}`);

export const cancelDeAiJob = async (jobId: string) =>
  await fetchJson<{ job: DeAiJob }>(`/api/deai/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  });

export const waitForJob = async (
  jobId: string,
  onUpdate: (job: DeAiJob) => void
): Promise<DeAiJob> => {
  while (true) {
    const { job } = await getDeAiJob(jobId);
    onUpdate(job);
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled') {
      return job;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
  }
};
