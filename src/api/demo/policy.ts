import { Any, globAny } from '../../lib/format';

/**
 * TypeScript port of the backend guardrail engine (custom/gmcp/lib/Policy.php).
 * Order: key state → server allow-list → key allow-list → key scope → first
 * matching rule → constraints → default effect.
 */
export type Effect = 'allow' | 'deny' | 'approve';
export interface Decision { effect: Effect; reason: string; rule: string }
const EFFECTS: Effect[] = ['allow', 'deny', 'approve'];

export function facts(tool: Any, args: Any) {
  let repo = args.repo ?? null;
  if (repo && typeof repo === 'string' && !repo.includes('/')) repo = 'acme/' + repo;
  const branch = args.branch ?? args.base ?? args.head ?? args.ref ?? null;
  let project = args.project ?? args.project_key ?? null;
  if (!project && typeof args.issue_key === 'string' && args.issue_key.includes('-')) project = args.issue_key.split('-')[0].toUpperCase();
  return { tool: tool.name, risk: tool.risk || 'read', connector: tool.connector, repo, branch, project: project ? String(project).toUpperCase() : null, issue_key: args.issue_key ?? null };
}

function conditionHolds(when: Any, f: Any) {
  for (const [field, ops0] of Object.entries(when || {})) {
    const value = f[field] ?? null;
    const ops: Any = Array.isArray(ops0) || typeof ops0 !== 'object' ? { in: [].concat(ops0 as Any) } : ops0;
    for (const [op, list0] of Object.entries(ops)) {
      const list = ([] as unknown[]).concat(list0 as Any);
      if (op === 'in' && (value === null || !globAny(list, String(value)))) return false;
      if (op === 'not_in' && value !== null && globAny(list, String(value))) return false;
      if (op !== 'in' && op !== 'not_in') return false;
    }
  }
  return true;
}

export function evaluate(ctx: { tool: Any; args: Any; agent: Any; server: Any; policy: Any; recentCalls?: number; recentWrites?: number }): Decision {
  const { tool, args, agent, server, policy } = ctx;
  const f = facts(tool, args);
  const risk = f.risk;
  if (agent.status !== 'active') return { effect: 'deny', reason: 'API key is ' + (agent.status || 'inactive'), rule: 'agent.status' };
  if (agent.expires_at && new Date(agent.expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now()) return { effect: 'deny', reason: 'API key expired on ' + agent.expires_at, rule: 'agent.expired' };
  if (server.status !== 'active') return { effect: 'deny', reason: 'Server is paused', rule: 'server.status' };
  const serverTools: string[] = server.tools || [];
  if (serverTools.length && !serverTools.includes(tool.name)) return { effect: 'deny', reason: 'Tool is not enabled on this server', rule: 'server.tools' };
  const override: string[] | null = agent.tools_override;
  if (override && override.length && !override.includes(tool.name)) return { effect: 'deny', reason: "Tool is not in this API key's allow-list", rule: 'agent.tools' };
  const scope = agent.scope || 'read';
  if (scope === 'read' && risk !== 'read') return { effect: 'deny', reason: `Key scope is read-only; "${tool.name}" is a ${risk} tool`, rule: 'agent.scope' };
  if (scope === 'write' && risk === 'destructive') return { effect: 'deny', reason: 'Key scope is write; destructive tools need the admin scope', rule: 'agent.scope' };

  for (const rule of policy?.rules || []) {
    if (!globAny(rule.match || [], tool.name)) continue;
    if (rule.when && !conditionHolds(rule.when, f)) continue;
    const effect: Effect = EFFECTS.includes(rule.effect) ? rule.effect : 'deny';
    return { effect, reason: `Rule "${rule.name || rule.id}"` + (rule.note ? ': ' + rule.note : ''), rule: 'policy.rule:' + (rule.id || rule.name) };
  }
  const c = policy?.constraints || {};
  if (c.allowed_repos?.length && f.repo && !globAny(c.allowed_repos, f.repo)) return { effect: 'deny', reason: `Repository ${f.repo} is outside the allowed list`, rule: 'constraint.allowed_repos' };
  if (c.allowed_jira_projects?.length && f.project && !globAny(c.allowed_jira_projects, f.project)) return { effect: 'deny', reason: `Jira project ${f.project} is outside the allowed list`, rule: 'constraint.allowed_jira_projects' };
  if (c.protected_branches?.length && risk !== 'read' && f.branch && globAny(c.protected_branches, f.branch)) {
    const effect: Effect = EFFECTS.includes(c.protected_branches_effect) ? c.protected_branches_effect : 'approve';
    return { effect, reason: `Branch "${f.branch}" is protected`, rule: 'constraint.protected_branches' };
  }
  if (c.max_calls_per_minute && (ctx.recentCalls || 0) >= c.max_calls_per_minute) return { effect: 'deny', reason: `Rate limit: ${c.max_calls_per_minute} calls/minute`, rule: 'constraint.max_calls_per_minute' };
  if (c.max_writes_per_hour && risk !== 'read' && (ctx.recentWrites || 0) >= c.max_writes_per_hour) return { effect: 'deny', reason: `Rate limit: ${c.max_writes_per_hour} writes/hour`, rule: 'constraint.max_writes_per_hour' };
  if (risk === 'destructive' && (c.approval_for_destructive ?? true)) return { effect: 'approve', reason: 'Destructive tools require a human approval', rule: 'constraint.approval_for_destructive' };
  if (risk === 'write' && c.approval_for_writes) return { effect: 'approve', reason: 'Write tools require a human approval on this policy', rule: 'constraint.approval_for_writes' };
  const def: Effect = EFFECTS.includes(policy?.default_effect) ? policy.default_effect : 'allow';
  return { effect: def, reason: `Policy default (${def})`, rule: 'policy.default' };
}

/** Same validation the backend applies to policy documents. */
export function normalize(input: Any) {
  const rules = (input.rules || []).map((r: Any, i: number) => {
    const match = ([] as string[]).concat(r.match || []).map(s => String(s).trim()).filter(Boolean);
    if (!match.length) return null;
    const out: Any = { id: String(r.id || 'r' + (i + 1)).replace(/[^a-z0-9_-]/gi, '') || 'r' + (i + 1), name: String(r.name || 'Rule ' + (i + 1)).slice(0, 80), match, effect: EFFECTS.includes(r.effect) ? r.effect : 'deny' };
    if (r.when && typeof r.when === 'object') out.when = r.when;
    if (r.note) out.note = String(r.note).slice(0, 200);
    return out;
  }).filter(Boolean);
  const c = input.constraints || {};
  const constraints: Any = {};
  for (const k of ['allowed_repos', 'protected_branches', 'allowed_jira_projects']) {
    const v = ([] as string[]).concat(c[k] || []).map(s => String(s).trim()).filter(Boolean);
    if (v.length) constraints[k] = v;
  }
  for (const k of ['max_calls_per_minute', 'max_writes_per_hour']) if (+c[k] > 0) constraints[k] = +c[k];
  constraints.approval_for_destructive = c.approval_for_destructive === undefined ? true : !!c.approval_for_destructive;
  constraints.approval_for_writes = !!c.approval_for_writes;
  if (EFFECTS.includes(c.protected_branches_effect)) constraints.protected_branches_effect = c.protected_branches_effect;
  return {
    name: String(input.name || 'Policy').trim().slice(0, 120) || 'Policy',
    description: String(input.description || '').trim().slice(0, 2000),
    default_effect: EFFECTS.includes(input.default_effect) ? input.default_effect : 'allow',
    rules, constraints,
  };
}
