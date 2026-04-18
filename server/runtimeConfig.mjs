const parsePositiveInteger = (value, fallback) => {
  const normalized = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
};

export const SERVER_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.BACKEND_REQUEST_TIMEOUT_MS,
  20 * 60 * 1000
);

export const SERVER_HEADERS_TIMEOUT_MS = Math.max(
  parsePositiveInteger(process.env.BACKEND_HEADERS_TIMEOUT_MS, SERVER_REQUEST_TIMEOUT_MS + 60_000),
  SERVER_REQUEST_TIMEOUT_MS + 1_000
);

export const SERVER_KEEP_ALIVE_TIMEOUT_MS = parsePositiveInteger(
  process.env.BACKEND_KEEP_ALIVE_TIMEOUT_MS,
  75 * 1000
);

export const SERVER_SOCKET_TIMEOUT_MS = parsePositiveInteger(
  process.env.BACKEND_SOCKET_TIMEOUT_MS,
  SERVER_REQUEST_TIMEOUT_MS
);

export const MODEL_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.DEAI_MODEL_REQUEST_TIMEOUT_MS,
  20 * 60 * 1000
);

export const MODEL_CANCEL_POLL_INTERVAL_MS = parsePositiveInteger(
  process.env.DEAI_MODEL_CANCEL_POLL_INTERVAL_MS,
  500
);

export const SMOKE_TIMEOUT_MS = parsePositiveInteger(process.env.SMOKE_TIMEOUT_MS, 20 * 60 * 1000);
