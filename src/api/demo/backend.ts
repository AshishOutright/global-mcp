import catalogJson from './catalog.json';
import seedJson from './seed.json';
import { evaluate, normalize, facts } from './policy';
import { Any, randToken, slugify, sqlNow, uuid } from '../../lib/format';

/**
 * In-browser implementation of the GMCP API (same action names and response
 * shapes as custom/gmcp/lib/Api.php). Used when the app runs without a backend,
 * e.g. on GitHub Pages. State lives in localStorage, so every visitor gets a
 * private sandbox that survives reloads.
 */

const STORE_KEY = 'gmcp-demo-v1';
const SESSION_KEY = 'gmcp-demo-session';
const catalog = catalogJson as Any;
const seed = seedJson as Any;
const PUBLIC_HOST = (import.meta.env.VITE_GMCP_PUBLIC_HOST || 'https://gmcp.outrightcrm.in').replace(/\/$/, '');

export class ApiError extends Error {
  status: number; data: Any;
  constructor(message: string, status = 400, data: Any = {}) { super(message); this.status = status; this.data = data; }
}

const TOOLS: Any[] = catalog.tools;
const toolByName = (n: string) => TOOLS.find(t => t.name === n);
const DATE_FIELDS = ['created_at', 'updated_at', 'last_call_at', 'last_used_at', 'expires_at', 'requested_at', 'decided_at', 'started_at', 'finished_at', 'last_seen_at', 'last_checked_at', 'trial_ends_at', 'ended_at'];

interface State {
  version: number;
  workspace: Any; plans: Any[]; connections: Any[]; policies: Any[]; servers: Any[]; agents: Any[]; sessions: Any[];
  audit: Any[]; approvals: Any[]; tests: Any[]; settings: Record<string, string>; members: Any[]; webhooks: Any[];
}

function shiftDates(rows: Any[], deltaMs: number) {
  for (const r of rows) for (const f of DATE_FIELDS) {
    if (typeof r[f] === 'string' && r[f]) {
      const ms = r[f].endsWith('.000');
      const d = new Date(r[f].replace('.000', '').replace(' ', 'T') + 'Z').getTime() + deltaMs;
      r[f] = new Date(d).toISOString().slice(0, 19).replace('T', ' ') + (ms ? '.000' : '');
    }
  }
  return rows;
}

function freshState(): State {
  const s: Any = JSON.parse(JSON.stringify(seed));
  const delta = Date.now() - new Date(s.dumped_at.replace(' ', 'T') + 'Z').getTime();
  for (const k of ['connections', 'policies', 'servers', 'agents', 'sessions', 'audit_logs', 'approvals', 'test_runs']) shiftDates(s[k], delta);
  return {
    version: 1,
    workspace: { id: uuid(), name: 'Demo sandbox', slug: 'demo', plan: 'pro', status: 'active', created_at: sqlNow(-15 * 86400), trial_ends_at: sqlNow(14 * 86400), settings: {} },
    plans: s.plans, connections: s.connections, policies: s.policies, servers: s.servers, agents: s.agents.map((a: Any) => ({ ...a })),
    // newest first; writeAudit() unshifts, so this order holds from here on
    sessions: s.sessions, audit: [...s.audit_logs].sort((a: Any, b: Any) => b.created_at.localeCompare(a.created_at)), approvals: s.approvals, tests: s.test_runs,
    settings: { approval_ttl_hours: '24', otel_service_name: 'gmcp', anthropic_model: 'claude-sonnet-5-5' },
    members: [], webhooks: [],
  };
}

let state: State = load();
function load(): State {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) { const s = JSON.parse(raw); if (s.version === 1) return s; } } catch { /* fresh */ }
  return freshState();
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* quota / private mode */ } }

type Who = { id: string; user_name: string; name: string; is_admin: boolean; is_guest: boolean } | null;
function getWho(): Who { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
function setWho(w: Who) { try { if (w) localStorage.setItem(SESSION_KEY, JSON.stringify(w)); else localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }

export function resetDemo() { state = freshState(); save(); }

// ---- helpers ----------------------------------------------------------------

const plan = () => state.plans.find(p => p.code === state.workspace.plan) || state.plans[0];
const monthStart = () => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`; };
function usage() {
  const p = plan();
  const L = p.limits;
  const callsMonth = state.audit.filter(a => a.created_at >= monthStart()).length;
  return {
    plan: p,
    servers: { used: state.servers.filter(s => !+s.deleted).length, limit: L.servers },
    connections: { used: state.connections.filter(c => !+c.deleted).length, limit: L.connections },
    agents: { used: state.agents.filter(a => !+a.deleted && a.status === 'active').length, limit: L.agents },
    members: { used: 1 + state.members.length, limit: L.members },
    calls_month: { used: callsMonth, limit: L.calls_month },
    audit_days: L.audit_days,
  };
}
function assertLimit(res: 'servers' | 'connections' | 'agents') {
  const u: Any = usage();
  if (u[res].used >= u[res].limit) throw new ApiError(`Plan limit reached: ${u[res].limit} ${res} on the ${u.plan.name} plan. Upgrade to add more.`, 402);
}
const live = <T extends Any>(rows: T[]) => rows.filter((r: Any) => !+r.deleted);
const endpoint = (slug: string) => `${PUBLIC_HOST}/mcp/${slug}`;
const policyOf = (s: Any) => live(state.policies).find(p => p.id === s.policy_id) || live(state.policies).sort((a, b) => (+b.is_default) - (+a.is_default))[0];

function toolsForServer(s: Any, ignoreAllowList = false) {
  const bound = s.connections || {};
  const allowed: string[] = ignoreAllowList ? [] : (s.tools || []);
  return TOOLS.filter(t => (t.connector === 'meta' || bound[t.connector]) && (!allowed.length || allowed.includes(t.name)));
}

function presentServer(s: Any, full = false) {
  const bound = s.connections || {};
  const details: Any = {};
  for (const [type, id] of Object.entries(bound)) { const c = live(state.connections).find(x => x.id === id); if (c) details[type] = { id: c.id, name: c.name, status: c.status, type: c.type }; }
  const p = policyOf(s);
  const out: Any = {
    id: s.id, name: s.name, slug: s.slug, description: s.description, status: s.status, policy_id: s.policy_id, policy: p ? { id: p.id, name: p.name } : null,
    connections: bound, connection_details: details, tools: s.tools || [], settings: s.settings || {}, calls_total: state.audit.filter(a => a.server_id === s.id).length,
    last_call_at: s.last_call_at, created_at: s.created_at, endpoint: endpoint(s.slug), tools_exposed: toolsForServer(s).length,
    agents: live(state.agents).filter(a => a.server_id === s.id && a.status === 'active').length,
  };
  if (full) {
    out.available_tools = toolsForServer(s, true).map(t => ({ name: t.name, connector: t.connector, risk: t.risk, description: t.description }));
    out.agent_list = live(state.agents).filter(a => a.server_id === s.id).map(presentAgent);
    out.calls_7d = state.audit.filter(a => a.server_id === s.id && a.created_at >= sqlNow(-7 * 86400)).length;
  }
  return out;
}
function presentAgent(a: Any) {
  const s = state.servers.find(x => x.id === a.server_id);
  return { id: a.id, server_id: a.server_id, server_name: s?.name, server_slug: s?.slug, name: a.name, agent_type: a.agent_type, key_prefix: a.key_prefix, scope: a.scope,
    tools_override: a.tools_override || null, status: a.status, expires_at: a.expires_at, last_used_at: a.last_used_at, last_ip: a.last_ip,
    calls_total: state.audit.filter(x => x.agent_id === a.id).length, created_at: a.created_at, endpoint: s ? endpoint(s.slug) : null };
}
function presentPolicy(p: Any) {
  return { id: p.id, name: p.name, description: p.description, default_effect: p.default_effect, rules: p.rules || [], constraints: p.constraints || {},
    is_default: +p.is_default, created_at: p.created_at, updated_at: p.updated_at, servers: live(state.servers).filter(s => s.policy_id === p.id).length };
}
function presentConnection(c: Any) {
  return { id: c.id, type: c.type, name: c.name, config: c.config || {}, secret_masked: c.secret_masked || { token: 'demo••••••••' + String(c.id).slice(-4) }, meta: c.meta || {},
    status: c.status, last_checked_at: c.last_checked_at, last_error: c.last_error, created_at: c.created_at, updated_at: c.updated_at,
    used_by: live(state.servers).filter(s => Object.values(s.connections || {}).includes(c.id)).map(s => ({ id: s.id, name: s.name })) };
}
function auditRow(a: Any) {
  const s = state.servers.find(x => x.id === a.server_id); const g = state.agents.find(x => x.id === a.agent_id);
  return { ...a, input_preview: String(a.input || '').slice(0, 400), output_preview: String(a.output || '').slice(0, 400), server_name: s?.name || null, agent_name: g?.name || null, user_name: a.user_id ? (getWho()?.name || 'you') : null };
}

function writeAudit(p: Any) {
  const row = { id: uuid(), server_id: p.server_id ?? null, agent_id: p.agent_id ?? null, user_id: p.user_id ?? null, session_id: null, request_id: p.request_id ?? 'playground',
    actor_type: p.actor_type || 'user', tool_name: p.tool_name, risk: p.risk, input: JSON.stringify(p.input || {}), output: p.output === undefined || p.output === null ? null : JSON.stringify(p.output),
    status: p.status, decision_reason: p.reason ?? null, rule_matched: p.rule ?? null, approval_id: p.approval_id ?? null, duration_ms: p.duration_ms ?? Math.round(80 + Math.random() * 500),
    ip: '203.0.113.5', user_agent: navigator.userAgent.slice(0, 120), trace_id: randHex(32), span_id: randHex(16), created_at: sqlNow() + '.000' };
  state.audit.unshift(row);
  const srv = state.servers.find(x => x.id === row.server_id); if (srv) srv.last_call_at = sqlNow();
  const ag = state.agents.find(x => x.id === row.agent_id); if (ag) ag.last_used_at = sqlNow();
  return row;
}
const randHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n / 2)), b => b.toString(16).padStart(2, '0')).join('');

function respond(tool: string, args: Any) {
  const base = seed.responses[tool];
  const out = base ? JSON.parse(JSON.stringify(base)) : { ok: true, tool };
  if (out && typeof out === 'object' && !Array.isArray(out)) {
    if (args.title) out.title = args.title;
    if (args.issue_key && 'key' in out) out.key = String(args.issue_key).toUpperCase();
    if (args.path && 'path' in out) out.path = args.path;
    if (tool === 'tests_run') { out.run_id = uuid(); if (args.name) out.name = args.name; }
  }
  return out;
}

function validateArgs(tool: Any, args: Any) {
  const sch = tool.inputSchema || {};
  for (const r of sch.required || []) if (args[r] === undefined || args[r] === null || args[r] === '') throw new ApiError(`Missing required argument "${r}"`);
  const props = sch.properties || {};
  for (const k of Object.keys(args)) if (!(k in props)) throw new ApiError(`Unknown argument "${k}"`);
}

function me() {
  const who = getWho()!;
  return { user: who, is_guest: who.is_guest, workspace: state.workspace, role: 'owner', usage: usage(), pending_approvals: state.approvals.filter(a => a.status === 'pending').length,
    site_url: PUBLIC_HOST, version: '1.0.0-demo', ai: false, workspaces: [state.workspace], demo: true };
}

function dashboard() {
  const since = (d: number) => sqlNow(-d * 86400);
  const a30 = state.audit.filter(a => a.created_at >= since(30));
  const byStatus = Object.entries(a30.reduce((m: Any, a) => { m[a.status] = (m[a.status] || 0) + 1; return m; }, {})).map(([status, n]) => ({ status, n }));
  const days: Any = {};
  for (const a of state.audit.filter(x => x.created_at >= since(14))) { const d = a.created_at.slice(0, 10); days[d] = days[d] || { d, n: 0, denied: 0, errors: 0 }; days[d].n++; if (a.status === 'denied') days[d].denied++; if (a.status === 'error') days[d].errors++; }
  const tools: Any = {}; for (const a of a30) { tools[a.tool_name] = tools[a.tool_name] || { tool_name: a.tool_name, n: 0, total: 0 }; tools[a.tool_name].n++; tools[a.tool_name].total += a.duration_ms || 0; }
  const agents: Any = {}; for (const a of a30) { if (!a.agent_id) continue; const g = state.agents.find(x => x.id === a.agent_id); if (!g) continue; agents[g.id] = agents[g.id] || { name: g.name, agent_type: g.agent_type, n: 0, denied: 0 }; agents[g.id].n++; if (a.status === 'denied') agents[g.id].denied++; }
  const durs = state.audit.filter(a => a.created_at >= since(7) && a.duration_ms).map(a => a.duration_ms).sort((x, y) => x - y);
  return {
    stats: { by_status: byStatus, by_day: Object.values(days).sort((x: Any, y: Any) => x.d.localeCompare(y.d)), top_tools: Object.values(tools).sort((x: Any, y: Any) => y.n - x.n).slice(0, 8).map((t: Any) => ({ ...t, avg_ms: t.total / t.n })),
      top_agents: Object.values(agents).sort((x: Any, y: Any) => y.n - x.n).slice(0, 6), recent: state.audit.slice(0, 8).map(auditRow), p95_ms: durs.length ? durs[Math.max(0, Math.floor(durs.length * 0.95) - 1)] : 0 },
    counts: {
      servers: live(state.servers).length, servers_active: live(state.servers).filter(s => s.status === 'active').length, agents: live(state.agents).filter(a => a.status === 'active').length,
      connections: live(state.connections).length, connections_error: live(state.connections).filter(c => c.status === 'error').length,
      pending_approvals: state.approvals.filter(a => a.status === 'pending').length, calls_24h: state.audit.filter(a => a.created_at >= since(1)).length,
      denied_24h: state.audit.filter(a => a.created_at >= since(1) && a.status === 'denied').length, sessions_active: state.sessions.filter(s => !s.ended_at && s.last_seen_at >= sqlNow(-3600)).length,
      tests_running: state.tests.filter(t => ['queued', 'running'].includes(t.status)).length,
    },
    usage: usage(),
    servers: live(state.servers).map(s => presentServer(s)).sort((a, b) => b.calls_total - a.calls_total).slice(0, 5),
    pending: state.approvals.filter(a => a.status === 'pending').slice(0, 5).map(p => ({ id: p.id, tool_name: p.tool_name, reason: p.reason, requested_at: p.requested_at, agent_name: state.agents.find(g => g.id === p.agent_id)?.name, server_name: state.servers.find(s => s.id === p.server_id)?.name })),
  };
}

function server(id: string) { const s = live(state.servers).find(x => x.id === id); if (!s) throw new ApiError('Server not found', 404); return s; }

function simulate(i: Any) {
  const s = server(i.server_id);
  const agent = i.agent_id ? state.agents.find(a => a.id === i.agent_id) : { id: 'sim', status: 'active', scope: ['read', 'write', 'admin'].includes(i.scope) ? i.scope : 'admin', tools_override: null, expires_at: null };
  let policy = i.policy_id ? state.policies.find(p => p.id === i.policy_id) : policyOf(s);
  if (i.policy_draft) policy = normalize(i.policy_draft);
  let tools = toolsForServer(s); if (i.tool) tools = tools.filter(t => t.name === i.tool);
  return { policy: policy?.name || 'draft', scope: agent!.scope, results: tools.map(t => { const d = evaluate({ tool: t, args: i.args || {}, agent, server: s, policy }); return { tool: t.name, connector: t.connector, risk: t.risk, ...d }; }) };
}

function playground(i: Any) {
  const s = server(i.server_id);
  const tool = toolByName(i.tool);
  if (!tool || !toolsForServer(s).some(t => t.name === tool.name)) throw new ApiError('Tool is not available on this server');
  const args = i.args || {};
  const agent = i.agent_id ? state.agents.find(a => a.id === i.agent_id && !+a.deleted) : null;
  const acting = agent || { id: null, status: 'active', scope: 'admin', tools_override: null, expires_at: null };
  const policy = policyOf(s);
  const recent = state.audit.filter(a => a.agent_id === acting.id && a.created_at >= sqlNow(-60)).length;
  const base = { server_id: s.id, agent_id: agent?.id ?? null, user_id: getWho()?.id, actor_type: 'user', tool_name: tool.name, risk: tool.risk, input: args };
  const d = evaluate({ tool, args, agent: acting, server: s, policy, recentCalls: recent });
  if (d.effect === 'deny') { const r = writeAudit({ ...base, status: 'denied', reason: d.reason, rule: d.rule, duration_ms: 4 }); save(); return { status: 'denied', reason: d.reason, rule: d.rule, audit_id: r.id }; }
  if (d.effect === 'approve' && !i.override_approval) { const r = writeAudit({ ...base, status: 'denied', reason: 'Would require approval: ' + d.reason + ' (re-run with override to execute as yourself)', rule: d.rule, duration_ms: 4 }); save(); return { status: 'approve', reason: d.reason, rule: d.rule, audit_id: r.id }; }
  try {
    validateArgs(tool, args);
    const out = tool.connector === 'meta' ? metaTool(tool.name, args, s, acting, policy) : respond(tool.name, args);
    const r = writeAudit({ ...base, status: 'allowed', output: out, reason: d.reason + (i.override_approval ? ' (approval overridden by user)' : ''), rule: d.rule });
    save(); return { status: 'ok', result: out, audit_id: r.id, duration_ms: r.duration_ms };
  } catch (e: Any) {
    const r = writeAudit({ ...base, status: 'error', output: { error: e.message }, reason: d.reason, rule: d.rule }); save();
    return { status: 'error', error: e.message, audit_id: r.id };
  }
}

function metaTool(name: string, args: Any, s: Any, agent: Any, policy: Any) {
  if (name === 'gmcp_whoami') return { server: { name: s.name, slug: s.slug, status: s.status }, agent: { name: agent.name || 'you', scope: agent.scope }, policy: { name: policy?.name, rules: policy?.rules?.length || 0, constraints: policy?.constraints }, tools_available: toolsForServer(s).length };
  if (name === 'gmcp_list_permissions') return { tools: toolsForServer(s).map(t => ({ tool: t.name, risk: t.risk, ...evaluate({ tool: t, args: args.args || {}, agent, server: s, policy }) })) };
  if (name === 'gmcp_recent_activity') return state.audit.filter(a => a.agent_id === agent.id).slice(0, args.limit || 20).map(a => ({ tool: a.tool_name, status: a.status, reason: a.decision_reason, at: a.created_at }));
  if (name === 'gmcp_approval_status') { const a = state.approvals.find(x => x.id === args.approval_id); if (!a) throw new ApiError('Unknown approval id'); return { approval_id: a.id, status: a.status, result: a.result ?? null }; }
  return {};
}

// ---- dispatcher ---------------------------------------------------------------

const GUEST_BLOCKED = ['connections.create', 'connections.update', 'connections.delete', 'settings.set', 'otel.test', 'members.add', 'members.remove', 'workspace.update', 'billing.change_plan', 'policies.ai_generate', 'audit.ai_summary'];

export async function demoApi(action: string, i: Any = {}): Promise<Any> {
  await new Promise(r => setTimeout(r, 120 + Math.random() * 160)); // feel like a network
  switch (action) {
    case 'auth.guest': setWho({ id: 'guest-demo', user_name: 'guest', name: 'Guest', is_admin: false, is_guest: true }); return { redirect: '/app' };
    case 'auth.login': {
      const u = String(i.username || '').trim();
      if (!u || !i.password) throw new ApiError('Enter your username and password.', 422);
      setWho({ id: 'user-' + slugify(u), user_name: u, name: u.charAt(0).toUpperCase() + u.slice(1), is_admin: true, is_guest: false });
      return { redirect: '/app' };
    }
    case 'auth.logout': setWho(null); return { redirect: '/' };
    case 'auth.whoami': return getWho();
  }
  const who = getWho();
  if (!who) throw new ApiError('Please log in or continue as a guest.', 401);
  if (who.is_guest && GUEST_BLOCKED.includes(action)) throw new ApiError('Guests explore a demo sandbox. Log in to do this with your own account.', 403, { login_required: true });
  const res = handle(action, i, who);
  return res;
}

function handle(action: string, i: Any, who: NonNullable<Who>): Any {
  const now = sqlNow();
  switch (action) {
    case 'me': return me();
    case 'workspace.list': return [state.workspace];
    case 'workspace.update': if (i.name) state.workspace.name = String(i.name).slice(0, 120); save(); return me();
    case 'dashboard': return dashboard();
    case 'tools.catalog': return { tools: TOOLS, coming_soon: catalog.coming_soon, connectors: [] };
    case 'connections.types': return { types: catalog.connection_types, coming_soon: catalog.coming_soon };
    case 'connections.list': return live(state.connections).map(presentConnection);
    case 'connections.create': {
      assertLimit('connections');
      const type = i.type; if (!catalog.connection_types[type]) throw new ApiError('Unknown connection type');
      const secret = Object.values(i.secret || {})[0] as string | undefined;
      if (!secret) throw new ApiError('Token is required');
      const c = { id: uuid(), type, name: i.name || catalog.connection_types[type].label + ' connection', config: { ...(i.config || {}), demo: true }, meta: { simulated: true, note: 'Prototype: credentials are not sent anywhere' },
        status: 'active', last_checked_at: now, last_error: null, created_at: now, updated_at: now, deleted: 0, secret_masked: { token: secret.slice(0, 4) + '••••••••' + secret.slice(-4) } };
      state.connections.push(c); save(); return presentConnection(c);
    }
    case 'connections.update': { const c = live(state.connections).find(x => x.id === i.id); if (!c) throw new ApiError('Connection not found', 404); if (i.name) c.name = i.name; if (i.config) c.config = { ...c.config, ...i.config }; c.updated_at = now; save(); return presentConnection(c); }
    case 'connections.delete': { const c = live(state.connections).find(x => x.id === i.id); if (!c) throw new ApiError('Connection not found', 404); const used = live(state.servers).find(s => Object.values(s.connections || {}).includes(c.id)); if (used) throw new ApiError(`Connection is used by server "${used.name}". Unbind it first.`); c.deleted = 1; save(); return { ok: true }; }
    case 'connections.verify': { const c = live(state.connections).find(x => x.id === i.id); if (!c) throw new ApiError('Connection not found', 404); c.status = 'active'; c.last_checked_at = now; c.last_error = null; save(); return { ok: true, meta: c.meta }; }

    case 'servers.list': return live(state.servers).map(s => presentServer(s));
    case 'servers.get': return presentServer(server(i.id), true);
    case 'servers.create': {
      assertLimit('servers');
      const name = String(i.name || 'My MCP server').slice(0, 120);
      let slug = slugify(i.slug || name); while (state.servers.some(s => s.slug === slug)) slug = slugify(name) + '-' + randToken(4).toLowerCase();
      const s = { id: uuid(), name, slug, description: i.description || '', status: 'active', policy_id: i.policy_id || null, connections: i.connections || {}, tools: i.tools || [], settings: {}, calls_total: 0, last_call_at: null, created_at: now, updated_at: now, deleted: 0 };
      state.servers.push(s); save(); return presentServer(s, true);
    }
    case 'servers.update': {
      const s = server(i.id);
      for (const k of ['name', 'description', 'connections', 'tools']) if (i[k] !== undefined) s[k] = i[k];
      if (i.status) s.status = i.status === 'paused' ? 'paused' : 'active';
      if ('policy_id' in i) s.policy_id = i.policy_id || null;
      if (i.slug) { const slug = slugify(i.slug); if (state.servers.some(x => x.slug === slug && x.id !== s.id)) throw new ApiError('Slug already taken'); s.slug = slug; }
      s.updated_at = now; save(); return presentServer(s, true);
    }
    case 'servers.delete': { const s = server(i.id); s.deleted = 1; state.agents.filter(a => a.server_id === s.id).forEach(a => { a.deleted = 1; a.status = 'revoked'; }); save(); return { ok: true }; }

    case 'agents.list': return live(state.agents).map(presentAgent).sort((a, b) => b.created_at.localeCompare(a.created_at));
    case 'agents.create': {
      assertLimit('agents');
      const s = server(i.server_id); const key = 'gmcp_live_' + randToken(40);
      const a = { id: uuid(), server_id: s.id, name: i.name || 'Agent key', agent_type: i.agent_type || 'custom', key_prefix: key.slice(0, 16), scope: ['read', 'write', 'admin'].includes(i.scope) ? i.scope : 'read',
        tools_override: i.tools_override?.length ? i.tools_override : null, status: 'active', expires_at: +i.expires_days > 0 ? sqlNow(+i.expires_days * 86400) : null, last_used_at: null, last_ip: null, calls_total: 0, created_at: now, updated_at: now, deleted: 0 };
      state.agents.push(a); save(); return { ...presentAgent(a), api_key: key, endpoint: endpoint(s.slug) };
    }
    case 'agents.update': { const a = live(state.agents).find(x => x.id === i.id); if (!a) throw new ApiError('Key not found', 404); for (const k of ['name', 'scope', 'status', 'tools_override']) if (i[k] !== undefined) a[k] = i[k]; save(); return { ok: true }; }
    case 'agents.revoke': { const a = state.agents.find(x => x.id === i.id); if (a) a.status = 'revoked'; save(); return { ok: true }; }
    case 'agents.rotate': { const a = state.agents.find(x => x.id === i.id); if (!a) throw new ApiError('Key not found', 404); const key = 'gmcp_live_' + randToken(40); a.key_prefix = key.slice(0, 16); a.status = 'active'; save(); return { api_key: key, endpoint: endpoint(state.servers.find(s => s.id === a.server_id)?.slug || '') }; }
    case 'agents.delete': { const a = state.agents.find(x => x.id === i.id); if (a) { a.deleted = 1; a.status = 'revoked'; } save(); return { ok: true }; }
    case 'sessions.list': return state.sessions.map(s => ({ ...s, agent_name: state.agents.find(a => a.id === s.agent_id)?.name, agent_type: state.agents.find(a => a.id === s.agent_id)?.agent_type, server_name: state.servers.find(v => v.id === s.server_id)?.name })).sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));

    case 'policies.list': return live(state.policies).sort((a, b) => (+b.is_default) - (+a.is_default)).map(presentPolicy);
    case 'policies.create': { const p = normalize(i); const row = { id: uuid(), ...p, is_default: 0, created_at: now, updated_at: now, deleted: 0 }; state.policies.push(row); save(); return presentPolicy(row); }
    case 'policies.update': {
      const row = live(state.policies).find(p => p.id === i.id); if (!row) throw new ApiError('Policy not found', 404);
      Object.assign(row, normalize({ ...row, ...i }), { updated_at: now });
      if (i.make_default) state.policies.forEach(p => { p.is_default = p.id === row.id ? 1 : 0; });
      save(); return presentPolicy(row);
    }
    case 'policies.delete': { const n = live(state.servers).filter(s => s.policy_id === i.id).length; if (n) throw new ApiError(`Policy is attached to ${n} server(s)`); const p = state.policies.find(x => x.id === i.id && !+x.is_default); if (p) p.deleted = 1; save(); return { ok: true }; }
    case 'policies.ai_generate': return aiDraft(String(i.description || ''));
    case 'policies.simulate': return simulate(i);

    case 'approvals.list': {
      state.approvals.forEach(a => { if (a.status === 'pending' && a.expires_at && a.expires_at < now) a.status = 'expired'; });
      return state.approvals.filter(a => !i.status || a.status === i.status).sort((a, b) => b.requested_at.localeCompare(a.requested_at)).map(a => {
        const g = state.agents.find(x => x.id === a.agent_id);
        return { ...a, input: typeof a.input === 'string' ? JSON.parse(a.input) : a.input, result: typeof a.result === 'string' ? JSON.parse(a.result) : a.result, risk: toolByName(a.tool_name)?.risk || 'write',
          server_name: state.servers.find(s => s.id === a.server_id)?.name, agent_name: g?.name, agent_type: g?.agent_type, decided_by_name: a.decided_by ? who.name : null };
      });
    }
    case 'approvals.decide': {
      const a = state.approvals.find(x => x.id === i.id); if (!a) throw new ApiError('Approval not found', 404);
      if (a.status !== 'pending') throw new ApiError('Already ' + a.status);
      const audit = state.audit.find(x => x.id === a.audit_id);
      const input = typeof a.input === 'string' ? JSON.parse(a.input) : a.input;
      Object.assign(a, { decided_at: now, decided_by: who.id, decision_note: i.note || null });
      if (i.decision === 'approve') {
        const out = respond(a.tool_name, input);
        a.status = 'approved'; a.result = JSON.stringify(out);
        if (audit) { audit.status = 'approved'; audit.decision_reason = 'Approved by user' + (i.note ? ': ' + i.note : ''); }
        writeAudit({ server_id: a.server_id, agent_id: a.agent_id, user_id: who.id, actor_type: 'user', tool_name: a.tool_name, risk: toolByName(a.tool_name)?.risk, input, output: out, status: 'approved', reason: 'Approved by user', rule: 'approval', approval_id: a.id, request_id: 'approval:' + a.id });
        save(); return { ok: true, result: out };
      }
      a.status = 'rejected'; if (audit) { audit.status = 'rejected'; audit.decision_reason = 'Rejected by user' + (i.note ? ': ' + i.note : ''); }
      save(); return { ok: true };
    }

    case 'audit.list': {
      let rows = state.audit;
      for (const k of ['server_id', 'agent_id', 'status', 'risk']) if (i[k]) rows = rows.filter(r => r[k] === i[k]);
      if (i.q) { const q = String(i.q).toLowerCase(); rows = rows.filter(r => r.tool_name.includes(q) || String(r.input).toLowerCase().includes(q) || String(r.decision_reason || '').toLowerCase().includes(q)); }
      rows = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const limit = Math.min(200, +i.limit || 50), offset = +i.offset || 0;
      return { total: rows.length, rows: rows.slice(offset, offset + limit).map(auditRow), limit, offset };
    }
    case 'audit.get': { const a = state.audit.find(x => x.id === i.id); if (!a) throw new ApiError('Not found', 404); const r = auditRow(a); const p = (v: Any) => { try { return JSON.parse(v); } catch { return v; } }; return { ...r, input: p(a.input), output: a.output == null ? null : p(a.output) }; }
    case 'audit.export': { const res = handle('audit.list', { ...i, limit: 200 }, who); return { exported: res.rows.length, total: res.total, rows: res.rows }; }
    case 'audit.ai_summary': return { summary: aiSummary(), rows: Math.min(120, state.audit.length) };

    case 'tests.list': return [...state.tests].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(t => ({ ...t, logs: undefined, server_name: state.servers.find(s => s.id === t.server_id)?.name, agent_name: state.agents.find(a => a.id === t.agent_id)?.name }));
    case 'tests.get': {
      const t = state.tests.find(x => x.id === i.id); if (!t) throw new ApiError('Run not found', 404);
      if (i.refresh && t.status === 'running' && Date.now() - new Date(t.started_at.replace(' ', 'T') + 'Z').getTime() > 60000) { t.status = 'passed'; t.finished_at = now; t.summary = { conclusion: 'success', jobs_total: 3, jobs_passed: 3, jobs_failed: 0 }; save(); }
      return t;
    }

    case 'playground.call': return playground(i);

    case 'settings.get': return {
      anthropic_api_key: state.settings.anthropic_api_key ? '••••••••••••' : '', anthropic_model: state.settings.anthropic_model, ai_configured: false,
      otel_enabled: state.settings.otel_enabled || '0', otel_endpoint: state.settings.otel_endpoint || '', otel_headers: state.settings.otel_headers ? '••••••••••••' : '', otel_service_name: state.settings.otel_service_name,
      webhook_secret: state.settings.webhook_secret ? '••••••••••••' : '', approval_ttl_hours: state.settings.approval_ttl_hours, notify_email: '',
      webhook_urls: { github: PUBLIC_HOST + '/webhooks/gmcp/github?ws=demo', jira: PUBLIC_HOST + '/webhooks/gmcp/jira?ws=demo&token=<secret>' },
    };
    case 'settings.set': for (const [k, v] of Object.entries(i.values || {})) if (typeof v === 'string' && !/^•+$/.test(v)) state.settings[k] = v; save(); return handle('settings.get', {}, who);
    case 'otel.test': return { status: 200, body: { note: 'Prototype: a test span would be POSTed to ' + (state.settings.otel_endpoint || '(no endpoint)') + '/v1/traces' } };
    case 'webhooks.list': return { events: [], urls: { github: PUBLIC_HOST + '/webhooks/gmcp/github?ws=demo', jira: PUBLIC_HOST + '/webhooks/gmcp/jira?ws=demo&token=<webhook secret>' } };
    case 'members.list': return { members: [{ id: '1', user_id: who.id, role: 'owner', created_at: state.workspace.created_at, user_name: who.user_name, first_name: who.name, last_name: '' }], crm_users: [] };
    case 'billing.plans': return { plans: state.plans.filter(p => +p.is_public), current: state.workspace.plan, usage: usage(), checkout: 'coming_soon' };
    case 'billing.change_plan': if (!state.plans.some(p => p.code === i.plan)) throw new ApiError('Unknown plan'); state.workspace.plan = i.plan; save(); return me();
    case 'system.status': return { version: '1.0.0-demo', tables: { 'browser storage': true }, php: '—', site: PUBLIC_HOST, is_admin: false, workspaces: 1, calls_total: state.audit.length };
    case 'demo.reset': resetDemo(); return { ok: true };
  }
  throw new ApiError(`Unknown action "${action}"`, 404);
}

// Prototype stand-ins for the Claude-powered features (the live backend calls the Claude API).
function aiDraft(desc: string) {
  const d = desc.toLowerCase();
  const repos = desc.match(/\b[a-z0-9_.-]+\/[a-z0-9_.*-]+/gi) || [];
  const projects = (desc.match(/\b[A-Z]{2,10}\b/g) || []).filter(p => !['PR', 'PRS', 'API', 'CI', 'AND', 'OR', 'NOT'].includes(p));
  const rpm = desc.match(/(\d+)\s*(calls|requests)?\s*(per|\/)\s*min/i);
  const rules: Any[] = [];
  if (/merge/.test(d)) rules.push({ id: 'r1', name: 'Approve merges', match: ['github_merge_pull'], effect: 'approve', note: 'A person signs off on merges' });
  if (/delete|never delete/.test(d)) rules.push({ id: 'r2', name: 'Block deletes', match: ['*_delete_*', 'github_delete_branch'], effect: 'deny' });
  if (/done|transition/.test(d)) rules.push({ id: 'r3', name: 'Approve transitions', match: ['jira_transition_issue'], effect: 'approve' });
  if (/read[- ]?only|only read/.test(d)) rules.push({ id: 'r4', name: 'Read only', match: ['*'], effect: 'deny', when: { risk: { in: ['write', 'destructive'] } } });
  return normalize({ name: 'AI draft: ' + desc.split(/[.\n]/)[0].slice(0, 40), description: desc.slice(0, 200), default_effect: 'allow', rules,
    constraints: { allowed_repos: repos, allowed_jira_projects: projects, protected_branches: /main|release/.test(d) ? ['main', 'release/*'] : [], max_calls_per_minute: rpm ? +rpm[1] : 60, approval_for_destructive: true } });
}
function aiSummary() {
  const rows = state.audit.slice(0, 120);
  const denied = rows.filter(r => r.status === 'denied'); const pend = state.approvals.filter(a => a.status === 'pending');
  const byTool = Object.entries(denied.reduce((m: Any, r) => { m[r.tool_name] = (m[r.tool_name] || 0) + 1; return m; }, {})).sort((a: Any, b: Any) => b[1] - a[1]);
  return `## What happened\nAgents made ${rows.length} tool calls, mostly reading Jira issues and GitHub files, opening branches and pull requests, and running tests.\n\n## Flags\n- ${denied.length} calls were blocked${byTool[0] ? `, most often \`${byTool[0][0]}\` (${byTool[0][1]}×)` : ''}.\n- ${pend.length} risky action(s) are waiting for approval.\n- Read-only keys repeatedly tried write tools: consider giving the nightly triage agent a narrower tool allow-list instead.\n\n## Recommendations\n1. Keep merges behind approval; they are the highest-impact action in this log.\n2. Add \`acme/infra\` to a separate server so the backend agent can't reach it.\n3. Lower \`max_writes_per_hour\` to 60 for agents that only triage.\n\n_Prototype summary generated in the browser. The live backend asks Claude to write this._`;
}

export { facts };
