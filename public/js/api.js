// Thin fetch wrapper. Throws ApiError with status + message on failure so the
// state machine can branch on it (retry, session-expired, conflict, etc.).
export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body || {};
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    // Network failure (offline, DNS, server down).
    throw new ApiError(0, 'Network unavailable. Check your connection.', {});
  }
  let data = {};
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, data.error || `Request failed (${res.status}).`, data);
  }
  return data;
}

export const api = {
  register: (firstName, surname, consent) =>
    request('POST', '/api/register', { firstName, surname, consent }),
  start: (sessionId) => request('POST', '/api/start', { sessionId }),
  submit: (sessionId, logoId, answer) =>
    request('POST', '/api/submit', { sessionId, logoId, answer }),
  timeout: (sessionId, logoId) => request('POST', '/api/timeout', { sessionId, logoId }),
  next: (sessionId) => request('POST', '/api/next', { sessionId }),
  results: (sessionId) => request('GET', `/api/results/${sessionId}`),
  leaderboard: (sessionId) =>
    request('GET', `/api/leaderboard${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`),
};
