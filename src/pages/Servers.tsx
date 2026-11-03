import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { PageHead } from '../components/Layout';
import { useSession } from '../components/Session';
import { Code, CopyButton, Empty, ErrorCard, Field, Loading, Modal, Pill, RiskPill, StatusPill, useAsync, useConfirm, useToast } from '../components/ui';
import { AgentForm, AgentTable } from './Agents';
import { ConnectSnippets } from './Docs';
import { ago, Any, connIcon, num, slugify } from '../lib/format';

const TYPES = ['github', 'jira', 'tests'] as const;
const typeLabel = (t: string) => (t === 'tests' ? 'Test runner' : t[0].toUpperCase() + t.slice(1));

export function ServerForm({ existing, onClose, onDone }: { existing?: Any; onClose: () => void; onDone: (s: Any) => void }) {
  const { fail, refresh } = useSession();
  const { data } = useAsync(() => Promise.all([api('connections.list'), api('policies.list')]), []);
  const [f, setF] = useState<Any>({ name: existing?.name || '', slug: existing?.slug || '', description: existing?.description || '', policy_id: existing?.policy_id || '', connections: existing?.connections || {} });
  const [busy, setBusy] = useState(false);
  const [conns, policies] = data || [[], []];
  const save = async () => {
    setBusy(true);
    const payload = { ...f, policy_id: f.policy_id || null };
    try { const s = existing ? await api('servers.update', { id: existing.id, ...payload }) : await api('servers.create', payload); refresh(); onClose(); onDone(s); } catch (e) { fail(e); setBusy(false); }
  };
  return (
    <Modal title={existing ? 'Edit server' : 'New MCP server'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{existing ? 'Save' : 'Create server'}</button></>}>
      {!data ? <Loading /> : <>
        <Field label="Name"><input className="input" value={f.name} placeholder="e.g. Backend repo agent" onChange={e => setF({ ...f, name: e.target.value, slug: existing ? f.slug : slugify(e.target.value) })} /></Field>
        <Field label="Slug (endpoint path)" hint={<>Endpoint becomes <code>…/mcp/{f.slug || '<slug>'}</code></>}><input className="input" value={f.slug} onChange={e => setF({ ...f, slug: e.target.value })} placeholder="backend-agent" /></Field>
        <Field label="Description / agent instructions"><textarea className="input" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="Shown to the agent on connect, e.g. 'Work only on the api/ folder; always run tests before opening a PR.'" /></Field>
        <div className="row">{TYPES.map(t => (
          <Field key={t} label={`${connIcon(t)} ${typeLabel(t)}`}>
            <select className="input" value={f.connections[t] || ''} onChange={e => { const c = { ...f.connections }; if (e.target.value) c[t] = e.target.value; else delete c[t]; setF({ ...f, connections: c }); }}>
              <option value="">— none —</option>{conns.filter((c: Any) => c.type === t).map((c: Any) => <option key={c.id} value={c.id}>{c.name}{c.status !== 'active' ? ` (${c.status})` : ''}</option>)}
            </select>
          </Field>))}
        </div>
        <Field label="Guardrail policy"><select className="input" value={f.policy_id} onChange={e => setF({ ...f, policy_id: e.target.value })}><option value="">— workspace default —</option>{policies.map((p: Any) => <option key={p.id} value={p.id}>{p.name}{p.is_default ? ' (default)' : ''}</option>)}</select></Field>
        {!conns.length && <div className="banner">No connections yet. The server will only expose the GMCP meta tools until you <Link to="/app/connections">add one</Link>.</div>}
      </>}
    </Modal>
  );
}

export default function Servers() {
  const { me } = useSession();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState(params.get('new') === '1');
  useEffect(() => { if (params.get('new')) setParams({}, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: list, error } = useAsync(() => api('servers.list'), []);
  if (error) return <ErrorCard error={error} />;
  if (!list) return <Loading />;
  const u = me.usage.servers;
  return (
    <>
      <PageHead title="MCP servers" text={<>Each server is one MCP endpoint with its own connections, tool allow-list and guardrail policy. <span className="muted">{u.used}/{u.limit} used</span></>} actions={<button className="btn btn-primary" onClick={() => setForm(true)}>+ New server</button>} />
      {list.length ? (
        <div className="grid g2">{list.map((s: Any) => (
          <Link className="card" key={s.id} to={'/app/servers/' + s.id} style={{ display: 'block' }}>
            <div className="card-head"><h2>🛰️ {s.name}</h2><StatusPill s={s.status} /></div>
            <div className="mono small" style={{ marginBottom: 10 }}>{s.endpoint}</div>
            <div className="inline">{TYPES.map(t => s.connection_details[t] ? <Pill key={t} kind={s.connection_details[t].status === 'active' ? 'pill-ok' : 'pill-warn'}>{connIcon(t)} {s.connection_details[t].name}</Pill> : <Pill key={t}>{connIcon(t)} not bound</Pill>)}</div>
            <div className="inline small sub" style={{ marginTop: 12 }}>🛡️ {s.policy?.name || 'no policy'} · {s.tools_exposed} tools · {s.agents} keys · {num(s.calls_total)} calls · last {ago(s.last_call_at)}</div>
          </Link>
        ))}</div>
      ) : <div className="card"><Empty icon="🛰️" title="Create your first MCP server" text="A server is what your coding agent connects to. Bind your connections, choose tools and attach a policy." action={<button className="btn btn-primary" onClick={() => setForm(true)}>+ New server</button>} /></div>}
      {form && <ServerForm onClose={() => setForm(false)} onDone={s => nav('/app/servers/' + s.id)} />}
    </>
  );
}

export function ServerDetail() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = ['overview', 'tools', 'keys', 'connect'].find(t => params.has(t)) || 'overview';
  const nav = useNavigate();
  const { fail } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [edit, setEdit] = useState(false);
  const [keyForm, setKeyForm] = useState(false);
  const { data: s, error, reload } = useAsync(() => api('servers.get', { id }), [id]);
  const [checked, setChecked] = useState<Set<string> | null>(null);
  useEffect(() => { if (s) setChecked(new Set(s.tools.length ? s.tools : s.available_tools.map((t: Any) => t.name))); }, [s]);
  if (error) return <ErrorCard error={error} />;
  if (!s || !checked) return <Loading />;
  const groups: Record<string, Any[]> = {};
  s.available_tools.forEach((t: Any) => (groups[t.connector] = groups[t.connector] || []).push(t));
  const run = async (fn: () => Promise<Any>, msg?: string) => { try { await fn(); if (msg) toast(msg, 'ok'); reload(); } catch (e) { fail(e); } };
  const saveTools = () => { const on = [...checked]; run(() => api('servers.update', { id, tools: on.length === s.available_tools.length ? [] : on }), 'Allow-list saved'); };
  return (
    <>
      <PageHead title={s.name} text={<><span className="mono">{s.endpoint}</span> <CopyButton text={s.endpoint} /></>}
        actions={<><StatusPill s={s.status} /><button className="btn" onClick={() => run(() => api('servers.update', { id, status: s.status === 'active' ? 'paused' : 'active' }))}>{s.status === 'active' ? '❚❚ Pause' : '▶ Resume'}</button>
          <button className="btn" onClick={() => setEdit(true)}>Edit</button>
          <button className="btn btn-danger" onClick={async () => { if (await confirm({ title: 'Delete server?', text: 'All its agent keys stop working immediately. Audit history is kept.', ok: 'Delete', danger: true })) { try { await api('servers.delete', { id }); nav('/app/servers'); } catch (e) { fail(e); } } }}>Delete</button></>} />
      <div className="tabs">{[['overview', 'Overview'], ['tools', `Tools (${s.tools_exposed})`], ['keys', `Agent keys (${s.agent_list.length})`], ['connect', 'Connect an agent']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setParams(k === 'overview' ? {} : { [k]: '' })}>{l}</button>)}</div>

      {tab === 'overview' && <>
        <div className="grid g3" style={{ marginBottom: 16 }}>
          <div className="card stat"><div className="label">Calls · 7d</div><div className="value">{num(s.calls_7d)}</div></div>
          <div className="card stat"><div className="label">Calls · total</div><div className="value">{num(s.calls_total)}</div><div className="delta">last {ago(s.last_call_at)}</div></div>
          <div className="card stat"><div className="label">Tools exposed</div><div className="value">{s.tools_exposed}</div><div className="delta">{s.tools.length ? 'custom allow-list' : 'all tools of bound connectors'}</div></div>
        </div>
        <div className="grid g2">
          <div className="card"><div className="card-head"><h2>Bindings</h2><button className="btn btn-sm" onClick={() => setEdit(true)}>Change</button></div>
            <dl className="kv">{TYPES.map(t => <Fragment key={t}><dt>{connIcon(t)} {typeLabel(t)}</dt><dd>{s.connection_details[t] ? <>{s.connection_details[t].name} <StatusPill s={s.connection_details[t].status} /></> : <span className="muted">not bound: tools hidden</span>}</dd></Fragment>)}
              <dt>🛡️ Policy</dt><dd>{s.policy ? <Link to="/app/policies">{s.policy.name}</Link> : <span className="muted">none</span>}</dd><dt>Instructions</dt><dd>{s.description || '—'}</dd></dl></div>
          <div className="card"><div className="card-head"><h2>Endpoint</h2></div><p className="sub small">Streamable HTTP · JSON-RPC 2.0 · protocol 2025-06-18. Authenticate with <code>Authorization: Bearer &lt;key&gt;</code>.</p>
            <Code text={`curl -X POST ${s.endpoint} \\\n  -H "Authorization: Bearer gmcp_live_..." \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`} /></div>
        </div>
      </>}

      {tab === 'tools' && (
        <div className="card">
          <div className="card-head"><div><h2>Tool allow-list</h2><p className="sub small">Unchecked tools are invisible to agents on this server. Keys and policies narrow this further.</p></div>
            <div className="inline"><button className="btn btn-sm" onClick={() => setChecked(new Set(s.available_tools.map((t: Any) => t.name)))}>Expose all</button><button className="btn btn-sm" onClick={() => setChecked(new Set(s.available_tools.filter((t: Any) => t.risk === 'read').map((t: Any) => t.name)))}>Reads only</button><button className="btn btn-primary btn-sm" onClick={saveTools}>Save</button></div></div>
          {Object.entries(groups).map(([g, tools]) => (
            <div key={g}><h3 style={{ margin: '14px 0 8px' }}>{connIcon(g)} {g} <span className="muted small">{tools.length}</span></h3>
              <div className="tools-list">{tools.map(t => (
                <label className="tool" key={t.name}><input type="checkbox" checked={checked.has(t.name)} onChange={e => { const n = new Set(checked); if (e.target.checked) n.add(t.name); else n.delete(t.name); setChecked(n); }} />
                  <span><b>{t.name}</b> <RiskPill r={t.risk} /><small>{t.description}</small></span></label>))}</div></div>
          ))}
          {s.available_tools.length <= 4 && <div className="banner info" style={{ marginTop: 14 }}>Bind a GitHub, Jira or test-runner connection to expose more tools.</div>}
        </div>
      )}

      {tab === 'keys' && <div className="card"><div className="card-head"><h2>Agent keys for this server</h2><button className="btn btn-primary btn-sm" onClick={() => setKeyForm(true)}>+ Issue key</button></div><AgentTable list={s.agent_list} onChange={reload} /></div>}
      {tab === 'connect' && <ConnectSnippets endpoint={s.endpoint} slug={s.slug} />}

      {edit && <ServerForm existing={s} onClose={() => setEdit(false)} onDone={() => reload()} />}
      {keyForm && <AgentForm serverId={s.id} onClose={() => setKeyForm(false)} onDone={reload} />}
    </>
  );
}
