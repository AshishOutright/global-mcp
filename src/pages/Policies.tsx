import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { PageHead } from '../components/Layout';
import { useSession } from '../components/Session';
import { EffectPill, ErrorCard, Field, Loading, Modal, Pill, RiskPill, useAsync, useConfirm, useToast } from '../components/ui';
import { Any } from '../lib/format';

type Rule = { name: string; match: string; effect: string; when: string };

function PolicyForm({ policy, onClose, onDone }: { policy?: Any; onClose: () => void; onDone: () => void }) {
  const { fail } = useSession();
  const toast = useToast();
  const p = policy || { name: '', description: '', default_effect: 'allow', rules: [], constraints: { approval_for_destructive: true } };
  const c = p.constraints || {};
  const [f, setF] = useState<Any>({ name: p.name, description: p.description || '', default_effect: p.default_effect,
    allowed_repos: (c.allowed_repos || []).join(', '), protected_branches: (c.protected_branches || []).join(', '), allowed_jira_projects: (c.allowed_jira_projects || []).join(', '),
    protected_branches_effect: c.protected_branches_effect || 'approve', max_calls_per_minute: c.max_calls_per_minute || '', max_writes_per_hour: c.max_writes_per_hour || '',
    approval_for_destructive: c.approval_for_destructive !== false, approval_for_writes: !!c.approval_for_writes });
  const [rules, setRules] = useState<Rule[]>((p.rules || []).map((r: Any) => ({ name: r.name, match: (r.match || []).join(', '), effect: r.effect, when: r.when ? JSON.stringify(r.when) : '' })));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: (e.target as HTMLInputElement).type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const setRule = (i: number, k: keyof Rule, v: string) => setRules(rules.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const list = (v: string) => v.split(',').map(s => s.trim()).filter(Boolean);
  const save = async () => {
    try {
      const rr = rules.map((r, i) => { let when = null; if (r.when.trim()) { try { when = JSON.parse(r.when); } catch { throw new Error(`Rule ${i + 1}: "when" is not valid JSON`); } } return { id: 'r' + (i + 1), name: r.name || 'Rule ' + (i + 1), match: list(r.match), effect: r.effect, when }; }).filter(r => r.match.length);
      const payload = { name: f.name, description: f.description, default_effect: f.default_effect, rules: rr, constraints: { allowed_repos: list(f.allowed_repos), protected_branches: list(f.protected_branches), allowed_jira_projects: list(f.allowed_jira_projects), protected_branches_effect: f.protected_branches_effect, max_calls_per_minute: +f.max_calls_per_minute || 0, max_writes_per_hour: +f.max_writes_per_hour || 0, approval_for_destructive: f.approval_for_destructive, approval_for_writes: f.approval_for_writes } };
      if (policy?.id) await api('policies.update', { id: policy.id, ...payload }); else await api('policies.create', payload);
      toast('Policy saved', 'ok'); onClose(); onDone();
    } catch (e) { fail(e); }
  };
  return (
    <Modal wide title={policy?.id ? 'Edit policy' : 'New policy'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save policy</button></>}>
      <div className="row"><Field label="Name"><input className="input" value={f.name} onChange={set('name')} /></Field><Field label="Default effect (when no rule matches)"><select className="input" value={f.default_effect} onChange={set('default_effect')}><option value="allow">allow</option><option value="deny">deny</option></select></Field></div>
      <Field label="Description"><input className="input" value={f.description} onChange={set('description')} /></Field>
      <h3 style={{ margin: '8px 0' }}>Rules <span className="muted small">evaluated top-down, first match wins · globs like <code>github_*</code>, <code>*_delete_*</code></span></h3>
      {rules.map((r, i) => (
        <div className="rule" key={i}>
          <span className="drag">{i + 1}</span>
          <input className="input" placeholder="Rule name" value={r.name} onChange={e => setRule(i, 'name', e.target.value)} />
          <input className="input mono" placeholder="github_*, jira_create_issue" value={r.match} onChange={e => setRule(i, 'match', e.target.value)} />
          <select className="input" value={r.effect} onChange={e => setRule(i, 'effect', e.target.value)}><option value="allow">allow</option><option value="deny">deny</option><option value="approve">approve</option></select>
          <input className="input mono" placeholder='when e.g. {"branch":{"in":["main"]}}' value={r.when} onChange={e => setRule(i, 'when', e.target.value)} />
          <button className="icon-btn" type="button" title="Remove" onClick={() => setRules(rules.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="btn btn-sm" type="button" onClick={() => setRules([...rules, { name: '', match: '', effect: 'deny', when: '' }])}>+ Add rule</button>
      <div className="help" style={{ marginTop: 8 }}><b>when</b> conditions (JSON) can use <code>repo</code>, <code>branch</code>, <code>project</code>, <code>issue_key</code>, <code>risk</code> with <code>in</code> / <code>not_in</code> glob lists. Example: <code>{'{"risk":{"in":["write","destructive"]}}'}</code></div>
      <h3 style={{ margin: '16px 0 8px' }}>Constraints</h3>
      <div className="row"><Field label="Allowed repositories (globs, comma)"><input className="input" value={f.allowed_repos} onChange={set('allowed_repos')} placeholder="acme/*, acme-labs/api" /></Field><Field label="Protected branches"><input className="input" value={f.protected_branches} onChange={set('protected_branches')} placeholder="main, master, release/*" /></Field></div>
      <div className="row"><Field label="Allowed Jira projects"><input className="input" value={f.allowed_jira_projects} onChange={set('allowed_jira_projects')} placeholder="ENG, OPS" /></Field><Field label="Writes to protected branches"><select className="input" value={f.protected_branches_effect} onChange={set('protected_branches_effect')}><option value="approve">need approval</option><option value="deny">deny</option></select></Field></div>
      <div className="row"><Field label="Max calls / minute (per key)"><input className="input" type="number" min={0} value={f.max_calls_per_minute} onChange={set('max_calls_per_minute')} /></Field><Field label="Max writes / hour (per key)"><input className="input" type="number" min={0} value={f.max_writes_per_hour} onChange={set('max_writes_per_hour')} /></Field></div>
      <div className="inline"><label className="check"><input type="checkbox" checked={f.approval_for_destructive} onChange={set('approval_for_destructive')} /> Destructive tools need human approval</label><label className="check"><input type="checkbox" checked={f.approval_for_writes} onChange={set('approval_for_writes')} /> All write tools need approval</label></div>
    </Modal>
  );
}

function AiPolicy({ onClose, onDraft }: { onClose: () => void; onDraft: (d: Any) => void }) {
  const { fail } = useSession();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { onDraft(await api('policies.ai_generate', { description: text })); } catch (e) { if (e instanceof ApiError && e.data?.login_required) onClose(); fail(e); setBusy(false); }
  };
  return (
    <Modal title="✨ Build a policy with Claude" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !text.trim()} onClick={go}>{busy ? 'Drafting…' : 'Generate draft'}</button></>}>
      <p className="sub small" style={{ marginBottom: 10 }}>Describe what the agent may and may not do in plain English. Claude drafts the rules and constraints; you review before saving.</p>
      <Field label="Requirement"><textarea className="input" rows={5} value={text} onChange={e => setText(e.target.value)} placeholder="Agents may read everything in acme/* and open PRs against feature branches. Never touch main or release/*. Jira: only project ENG, no transitions to Done without approval. Max 30 calls per minute." /></Field>
      {busy && <div className="loading"><span className="spinner" /> Asking Claude…</div>}
    </Modal>
  );
}

export function Simulate({ policyId, onClose }: { policyId?: string; onClose: () => void }) {
  const { fail } = useSession();
  const { data: servers } = useAsync(() => api('servers.list'), []);
  const [f, setF] = useState({ server_id: '', scope: 'admin', args: '{"repo":"acme/api","branch":"main","issue_key":"ENG-1"}' });
  const [res, setRes] = useState<Any>(null);
  const run = async (form = f) => {
    let args = {}; try { args = JSON.parse(form.args || '{}'); } catch { return fail(new Error('Args must be JSON')); }
    try { setRes(await api('policies.simulate', { server_id: form.server_id || servers[0]?.id, scope: form.scope, args, policy_id: policyId || null })); } catch (e) { fail(e); }
  };
  useEffect(() => { if (servers?.length) run({ ...f, server_id: servers[0].id }); }, [servers]); // eslint-disable-line react-hooks/exhaustive-deps
  const cnt = { allow: 0, deny: 0, approve: 0 } as Record<string, number>;
  res?.results.forEach((x: Any) => cnt[x.effect]++);
  return (
    <Modal wide title="Simulate guardrails" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn btn-primary" onClick={() => run()}>Run simulation</button></>}>
      {!servers ? <Loading /> : !servers.length ? <p className="sub">Create a server first.</p> : <>
        <div className="row">
          <Field label="Server"><select className="input" value={f.server_id || servers[0].id} onChange={e => setF({ ...f, server_id: e.target.value })}>{servers.map((s: Any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Key scope"><select className="input" value={f.scope} onChange={e => setF({ ...f, scope: e.target.value })}><option>read</option><option>write</option><option>admin</option></select></Field>
          <Field label="Sample args (JSON)"><input className="input mono" value={f.args} onChange={e => setF({ ...f, args: e.target.value })} /></Field>
        </div>
        {res && <div className="small">
          <div className="inline" style={{ marginBottom: 8 }}><Pill kind="pill-ok">{cnt.allow} allow</Pill><Pill kind="pill-warn">{cnt.approve} approve</Pill><Pill kind="pill-bad">{cnt.deny} deny</Pill> <span className="muted">policy: {res.policy} · scope {res.scope}</span></div>
          <div className="table-wrap" style={{ maxHeight: 420 }}><table><thead><tr><th>Tool</th><th>Risk</th><th>Effect</th><th>Reason</th></tr></thead><tbody>
            {res.results.map((x: Any) => <tr key={x.tool}><td className="mono">{x.tool}</td><td><RiskPill r={x.risk} /></td><td><EffectPill e={x.effect} /></td><td className="small">{x.reason} <span className="muted mono">{x.rule}</span></td></tr>)}
          </tbody></table></div>
        </div>}
      </>}
    </Modal>
  );
}

export default function Policies() {
  const { fail } = useSession();
  const confirm = useConfirm();
  const toast = useToast();
  const [form, setForm] = useState<Any | null>(null);
  const [ai, setAi] = useState(false);
  const [sim, setSim] = useState<string | null>(null);
  const { data: list, error, reload } = useAsync(() => api('policies.list'), []);
  if (error) return <ErrorCard error={error} />;
  if (!list) return <Loading />;
  return (
    <>
      <PageHead title="Guardrail policies" text="Ordered rules (first match wins) plus constraints: allowed repos, protected branches, Jira projects, rate limits and human approvals."
        actions={<><button className="btn" onClick={() => setAi(true)}>✨ Build with AI</button><button className="btn btn-primary" onClick={() => setForm({})}>+ New policy</button></>} />
      <div className="grid g2">{list.map((p: Any) => {
        const c = p.constraints || {};
        return (
          <div className="card" key={p.id}>
            <div className="card-head"><h2>🛡️ {p.name} {p.is_default ? <Pill kind="pill-lime">default</Pill> : null}</h2><span className="sub small">{p.servers} server{p.servers === 1 ? '' : 's'}</span></div>
            <p className="sub small">{p.description}</p>
            <div className="inline small" style={{ margin: '10px 0' }}>
              <Pill kind={p.default_effect === 'allow' ? 'pill-ok' : 'pill-bad'}>default: {p.default_effect}</Pill>
              {c.protected_branches && <Pill>🔒 {c.protected_branches.join(', ')}</Pill>}
              {c.allowed_repos && <Pill>repos: {c.allowed_repos.join(', ')}</Pill>}
              {c.allowed_jira_projects && <Pill>jira: {c.allowed_jira_projects.join(', ')}</Pill>}
              {c.max_calls_per_minute && <Pill>{c.max_calls_per_minute}/min</Pill>}
              {c.approval_for_destructive !== false && <Pill kind="pill-warn">✋ approve destructive</Pill>}
              {c.approval_for_writes && <Pill kind="pill-warn">✋ approve writes</Pill>}
            </div>
            {p.rules.length ? <div className="stack" style={{ gap: 4 }}>{p.rules.map((r: Any) => <div className="tl" key={r.id} style={{ gridTemplateColumns: 'auto 1fr' }}><span><EffectPill e={r.effect} /></span><span><b>{r.name}</b> <span className="mono muted small">{(r.match || []).join(', ')}</span>{r.when && <span className="muted small"> when {JSON.stringify(r.when)}</span>}</span></div>)}</div>
              : <p className="muted small">No rules: constraints and the default apply.</p>}
            <div className="inline" style={{ marginTop: 12 }}>
              <button className="btn btn-sm" onClick={() => setForm(p)}>Edit</button>
              <button className="btn btn-sm" onClick={() => setSim(p.id)}>Simulate</button>
              {!p.is_default && <button className="btn btn-sm btn-ghost" onClick={async () => { try { await api('policies.update', { id: p.id, make_default: 1 }); toast('Default policy changed'); reload(); } catch (e) { fail(e); } }}>Make default</button>}
              {!p.is_default && <button className="btn btn-sm btn-ghost" onClick={async () => { if (await confirm({ title: 'Delete policy?', text: 'Servers using it must be moved first.', ok: 'Delete', danger: true })) { try { await api('policies.delete', { id: p.id }); reload(); } catch (e) { fail(e); } } }}>Delete</button>}
            </div>
          </div>
        );
      })}</div>
      {form && <PolicyForm policy={form.name !== undefined ? form : undefined} onClose={() => setForm(null)} onDone={reload} />}
      {ai && <AiPolicy onClose={() => setAi(false)} onDraft={d => { setAi(false); setForm({ ...d, id: undefined }); toast('Draft ready: review and save', 'ok'); }} />}
      {sim && <Simulate policyId={sim} onClose={() => setSim(null)} />}
    </>
  );
}
