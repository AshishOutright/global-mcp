/* eslint-disable @typescript-eslint/no-explicit-any */
export type Any = any;

const toDate = (d?: string | null) => {
  if (!d) return null;
  const s = d.includes('T') ? d : d.replace(' ', 'T') + (d.endsWith('Z') ? '' : 'Z');
  const x = new Date(s);
  return isNaN(x.getTime()) ? null : x;
};

export const num = (n: unknown) => Number(n || 0).toLocaleString();

export const fmtDate = (d?: string | null) => {
  const x = toDate(d);
  return x ? x.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
};

export const ago = (d?: string | null) => {
  const x = toDate(d);
  if (!x) return 'never';
  const s = (Date.now() - x.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
};

export const json = (v: unknown) => {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
};

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

export const uuid = () =>
  (crypto as Any).randomUUID ? (crypto as Any).randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export const randToken = (n = 40) => {
  const a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const buf = new Uint32Array(n); crypto.getRandomValues(buf);
  return Array.from(buf, v => a[v % a.length]).join('');
};

/** "YYYY-MM-DD HH:MM:SS" in UTC, same format as the PHP backend */
export const sqlNow = (offsetSec = 0) => new Date(Date.now() + offsetSec * 1000).toISOString().slice(0, 19).replace('T', ' ');

export const meterClass = (used: number, limit: number) => {
  const p = limit ? used / limit : 0;
  return p >= 1 ? 'bad' : p >= 0.8 ? 'warn' : '';
};

export const agentIcon = (t?: string) => ({ claude_code: '🤖', codex: '🧠', cursor: '🖱️', windsurf: '🏄', custom: '🔑' } as Record<string, string>)[t || ''] || '🔑';
export const connIcon = (t?: string) => ({ github: '🐙', jira: '🧩', tests: '🧪', meta: '🛡️' } as Record<string, string>)[t || ''] || '🔌';

export const globMatch = (pattern: string, subject: string) => {
  pattern = pattern.trim();
  if (!pattern) return false;
  if (pattern === '*') return true;
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  return re.test(subject);
};
export const globAny = (patterns: unknown[], subject: string) => (patterns || []).some(p => typeof p === 'string' && globMatch(p, subject));
