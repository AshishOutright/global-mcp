import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { PageHead } from '../components/Layout';
import { useSession } from '../components/Session';
import { Code, CopyButton, Empty, ErrorCard, Field, Loading, Modal, Pill, StatusPill, useAsync, useConfirm } from '../components/ui';
import { agentIcon, ago, Any, fmtDate, num } from '../lib/format';

export function KeyReveal({ apiKey, endpoint, onClose }: { apiKey: string; endpoint: string; onClose: () => void }) {
  return (
    <Modal title="Your new API key" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <div className="keybox"><b>Copy it now: it is shown only once.</b><code>{apiKey}</code><CopyButton text={apiKey} label="Copy key" className="btn btn-lime btn-sm" /></div>
      <h3 style={{ margin: '18px 0 8px' }}>Connect Claude Code</h3>
      <Code text={`claude mcp add --transport http gmcp ${endpoint} \\\n  --header "Authorization: Bearer ${apiKey}"`} />
      <p className="sub small" style={{ marginTop: 10 }}>More clients (Codex, Cursor, Windsurf, raw HTTP) under <Link to="/app/docs" onClick={onClose}>Setup &amp; docs</Link>.</p>
    </Modal>
  );
}

export function AgentForm({ serverId, onClose, onDone }: { serverId?: string; onClose: () => void; onDone: () => void }) {
  const { fail, refresh } = useSession();
  const { data } = useAsync(() => Promise.all([api('servers.list'), api('tools.catalog')]), []);
  const [form, setForm] = useState<Any>({ name: '', agent_type: 'claude_code', scope: 'read', expires_days: '30', server_id: serverId || '' });
  const [tools, setTools] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Any>(null);
  if (created) return <KeyReveal apiKey={created.api_key} endpoint={created.endpoint} onClose={() => { onClose(); onDone(); }} />;
  const [servers, cat] = data || [[], { tools: [] }];
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try { setCreated(await api('agents.create', { ...form, server_id: form.server_id || servers[0]?.id, tools_override: tools })); refresh(); } catch (e) { fail(e); setBusy(false); }
  };
  return (
    <Modal title="Issue an agent key" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !servers.length} onClick={save}>Create key</button></>}>
      {!data ? <Loading /> : <>
        <Field label="Agent name"><input className="input" value={form.name} onChange={set('name')} placeholder="e.g. Claude Code — Ravi laptop" /></Field>
        <div className="row">
          <Field label="Server"><select className="input" value={form.server_id || servers[0]?.id} onChange={set('server_id')}>{servers.map((s: Any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Agent type"><select className="input" value={form.agent_type} onChange={set('agent_type')}><option value="claude_code">Claude Code</option><option value="codex">OpenAI Codex</option><option value="cursor">Cursor</option><option value="windsurf">Windsurf</option><option value="custom">Custom / other</option></select></Field>
        </div>
        <div className="row">
          <Field label="Scope" hint="Policies and approvals still apply on top of the scope."><select className="input" value={form.scope} onChange={set('scope')}><option value="read">read: only read tools</option><option value="write">write: read + write tools</option><option value="admin">admin: includes destructive tools</option></select></Field>
          <Field label="Expires in"><select className="input" value={form.expires_days} onChange={set('expires_days')}><option value="">never</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option></select></Field>
        </div>
        <details><summary className="small sub" style={{ cursor: 'pointer' }}>Restrict to specific tools (optional)</summary>
          <div className="chips" style={{ marginTop: 10 }}>{cat.tools.map((t: Any) => <button type="button" key={t.name} className={`chip ${tools.includes(t.name) ? 'on' : ''}`} onClick={() => setTools(tools.includes(t.name) ? tools.filter(x => x !== t.name) : [...tools, t.name])}>{t.name}</button>)}</div>
        </details>
        {!servers.length && <div className="banner" style={{ marginTop: 12 }}>Create a server first.</div>}
      </>}
    </Modal>
  );
}

export function AgentTable({ list, onChange }: { list: Any[]; onChange: () => void }) {
  const { fail } = useSession();
  const confirm = useConfirm();
  const [revealed, setRevealed] = useState<Any>(null);
  if (!list.length) return <Empty icon="🔑" title="No keys yet" text="Issue a scoped key for each agent so every call is attributable." />;
  const act = async (fn: () => Promise<Any>) => { try { await fn(); onChange(); } catch (e) { fail(e); } };
  return (
    <>
      <div className="table-wrap"><table>
        <thead><tr><th>Agent</th><th>Server</th><th>Key</th><th>Scope</th><th>Status</th><th>Calls</th><th>Last used</th><th /></tr></thead>
        <tbody>{list.map(a => (
          <tr key={a.id}>
            <td>{agentIcon(a.agent_type)} <b>{a.name}</b><div className="muted small">{a.agent_type}{a.tools_override ? ` · ${a.tools_override.length} tools` : ''}</div></td>
            <td><Link to={'/app/servers/' + a.server_id}>{a.server_name}</Link></td>
            <td className="mono">{a.key_prefix}…</td>
            <td><Pill kind={a.scope === 'admin' ? 'pill-bad' : a.scope === 'write' ? 'pill-warn' : 'pill-info'}>{a.scope}</Pill></td>
            <td><StatusPill s={a.status} />{a.expires_at && <div className="muted small">exp {fmtDate(a.expires_at)}</div>}</td>
            <td>{num(a.calls_total)}</td>
            <td className="small">{ago(a.last_used_at)}<div className="muted">{a.last_ip}</div></td>
            <td className="td-r" style={{ whiteSpace: 'nowrap' }}>
              <button className="btn btn-xs" onClick={async () => { if (await confirm({ title: 'Rotate key?', text: 'The old key stops working immediately.', ok: 'Rotate' })) { try { setRevealed(await api('agents.rotate', { id: a.id })); } catch (e) { fail(e); } } }}>Rotate</button>{' '}
              {a.status === 'active' ? <button className="btn btn-xs" onClick={() => act(() => api('agents.revoke', { id: a.id }))}>Revoke</button> : <button className="btn btn-xs" onClick={() => act(() => api('agents.update', { id: a.id, status: 'active' }))}>Activate</button>}{' '}
              <button className="btn btn-xs btn-ghost" onClick={async () => { if (await confirm({ title: 'Delete key?', text: 'Audit history is kept.', ok: 'Delete', danger: true })) act(() => api('agents.delete', { id: a.id })); }}>✕</button>
            </td>
          </tr>
        ))}</tbody>
      </table></div>
      {revealed && <KeyReveal apiKey={revealed.api_key} endpoint={revealed.endpoint} onClose={() => { setRevealed(null); onChange(); }} />}
    </>
  );
}

export default function Agents() {
  const { me } = useSession();
  const [form, setForm] = useState(false);
  const { data, error, reload } = useAsync(() => Promise.all([api('agents.list'), api('sessions.list')]), []);
  if (error) return <ErrorCard error={error} />;
  if (!data) return <Loading />;
  const [list, sessions] = data;
  const u = me.usage.agents;
  return (
    <>
      <PageHead title="Agents & keys" text={<>One key per agent install. Scopes cap what a key can ever do; policies decide per call. <span className="muted">{u.used}/{u.limit} active</span></>} actions={<button className="btn btn-primary" onClick={() => setForm(true)}>+ Issue key</button>} />
      <div className="card" style={{ marginBottom: 16 }}><AgentTable list={list} onChange={reload} /></div>
      <div className="card"><div className="card-head"><h2>Recent MCP sessions</h2><span className="sub small">Session = one <code>initialize</code> handshake</span></div>
        {sessions.length ? <div className="table-wrap"><table><thead><tr><th>Session</th><th>Agent</th><th>Client</th><th>Server</th><th>Calls</th><th>Started</th><th>Last seen</th><th>IP</th></tr></thead><tbody>
          {sessions.map((s: Any) => <tr key={s.id}><td className="mono small">{s.id.slice(0, 14)}…</td><td>{agentIcon(s.agent_type)} {s.agent_name}</td><td>{s.client_name || '—'} <span className="muted small">{s.client_version}</span></td><td>{s.server_name}</td><td>{num(s.calls)}</td><td className="small">{fmtDate(s.created_at)}</td><td className="small">{ago(s.last_seen_at)}{s.ended_at ? ' · ended' : ''}</td><td className="mono small">{s.ip}</td></tr>)}
        </tbody></table></div> : <Empty icon="📡" title="No sessions yet" text="When an agent connects, its handshake shows up here." />}
      </div>
      {form && <AgentForm onClose={() => setForm(false)} onDone={reload} />}
    </>
  );
}
