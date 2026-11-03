import { Any } from '../lib/format';
import { ApiError, demoApi } from './demo/backend';

/**
 * One function for every screen: api('servers.list'), api('agents.create', {...}).
 * DEMO mode (default): handled in the browser by ./demo/backend.ts.
 * LIVE mode: VITE_GMCP_API_URL points at the PHP backend (entryPoint=gmcp_api);
 * the app must be served from the same origin so the session cookie is sent.
 */
const LIVE_URL = (import.meta.env.VITE_GMCP_API_URL || '').trim();
export const MODE: 'demo' | 'live' = LIVE_URL ? 'live' : 'demo';
export { ApiError };

let csrf: string | null = null;
async function liveCsrf(): Promise<string> {
  if (csrf) return csrf;
  const r = await fetch(LIVE_URL + (LIVE_URL.includes('?') ? '&' : '?') + 'csrf=1', { credentials: 'same-origin' });
  const j = await r.json();
  csrf = j?.data?.csrf || '';
  return csrf!;
}

async function liveApi(action: string, data: Any = {}): Promise<Any> {
  const send = async () => fetch(LIVE_URL, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-GMCP-Token': await liveCsrf() },
    body: JSON.stringify({ action, ...data }),
  });
  let r = await send();
  if (r.status === 419) { csrf = null; r = await send(); } // token rotated (e.g. after logout)
  let j: Any = null;
  try { j = await r.json(); } catch { /* not json */ }
  if (!j) throw new ApiError(`Server returned an invalid response (${r.status})`, r.status);
  if (!j.ok) throw new ApiError(j.error || 'Request failed', r.status, j.data || {});
  if (action === 'auth.logout' || action === 'auth.login' || action === 'auth.guest') csrf = null;
  return j.data;
}

export const api = (action: string, data: Any = {}) => (MODE === 'live' ? liveApi(action, data) : demoApi(action, data));
