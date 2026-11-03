import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { PageHead } from '../components/Layout';
import { useSession } from '../components/Session';
import { Drawer, Empty, ErrorCard, Field, Loading, Modal, Pill, RiskPill, StatusPill, useAsync, useToast } from '../components/ui';
import { Any, fmtDate, json, num } from '../lib/format';

export function AuditDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: r, error } = useAsync(() => api('audit.get', { id }), [id]);
  return (
    <Drawer onClose={onClose}>
      {error ? <ErrorCard error={error} /> : !r ? <Loading /> : <>
        <div className="card-head"><h2>{r.tool_name}</h2><button className="icon-btn" onClick={onClose}>✕</button></div>
        <div className="inline" style={{ marginBottom: 12 }}><StatusPill s={r.status} /><RiskPill r={r.risk} /><Pill>{r.actor_type === 'user' ? '👤 ' + (r.user_name || 'user') : '🔑 ' + (r.agent_name || 'agent')}</Pill></div>
        <dl className="kv small">
          <dt>When</dt><dd>{fmtDate(r.created_at)}</dd><dt>Duration</dt><dd>{r.duration_ms ?? '—'} ms</dd><dt>Server</dt><dd>{r.server_name || '—'}</dd>
          <dt>Decision</dt><dd>{r.decision_reason || '—'} <span className="mono muted">{r.rule_matched}</span></dd><dt>Session</dt><dd className="mono">{r.session_id || '—'}</dd>
          <dt>Request id</dt><dd className="mono">{r.request_id || '—'}</dd><dt>Trace</dt><dd className="mono">{r.trace_id} / {r.span_id}</dd><dt>Client</dt><dd className="mono">{r.ip}<br />{r.user_agent}</dd>
          {r.approval_id && <><dt>Approval</dt><dd><Link to="/app/approvals?all">{r.approval_id}</Link></dd></>}
        </dl>
        <h3 style={{ margin: '16px 0 6px' }}>Input</h3><pre className="json">{json(r.input)}</pre>
        <h3 style={{ margin: '16px 0 6px' }}>Output</h3><pre className="json">{r.output == null ? '—' : json(r.output)}</pre>
      </>}
    </Drawer>
  );
}

export default function Audit() {
  const { me, fail } = useSession();
  const toast = useToast();
  const [f, setF] = useState<Any>({ limit: 50, offset: 0 });
  const [draft, setDraft] = useState<Any>({});
  const [open, setOpen] = useState<string | null>(null);
  const [ai, setAi] = useState<{ busy: boolean; text?: string; err?: string } | null>(null);
  const { data, error } = useAsync(() => Promise.all([api('audit.list', f), api('servers.list'), api('agents.list')]), [JSON.stringify(f)]);
  if (error) return <ErrorCard error={error} />;
  if (!data) return <Loading />;
  const [res, servers, agents] = data;
  const apply = () => setF({ ...f, ...draft, offset: 0 });
  const exportJson = async () => {
    try {
      const r = await api('audit.export', f);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(r.rows, null, 2)], { type: 'application/json' }));
      a.download = `gmcp-audit-${new Date().toISOString().slice(0, 10)}.json`; a.click(); toast(`Exported ${r.exported} rows`);
    } catch (e) { fail(e); }
  };
  const summarize = async (focus: string) => { setAi({ busy: true }); try { const r = await api('audit.ai_summary', { ...f, focus }); setAi({ busy: false, text: r.summary }); } catch (e) { setAi(null); fail(e); } };
  const sel = (k: string, opts: [string, string][]) => <select className="input" style={{ maxWidth: 170 }} value={draft[k] ?? f[k] ?? ''} onChange={e => setDraft({ ...draft, [k]: e.target.value })}>{opts.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>;
  return (
    <>
      <PageHead title="Audit log" text={`Every tool call with input, output, actor, decision and timing. Retention: ${me.usage.audit_days} days on your plan.`}
        actions={<><button className="btn" onClick={() => setAi({ busy: false })}>✨ AI summary</button><button className="btn" onClick={exportJson}>⇩ Export JSON</button></>} />
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="inline">
          <input className="input" placeholder="Search tool / input / reason" style={{ maxWidth: 260 }} value={draft.q ?? f.q ?? ''} onChange={e => setDraft({ ...draft, q: e.target.value })} onKeyDown={e => e.key === 'Enter' && apply()} />
          {sel('status', [['', 'any status'], ['allowed', 'allowed'], ['denied', 'denied'], ['pending', 'pending'], ['approved', 'approved'], ['rejected', 'rejected'], ['error', 'error']])}
          {sel('risk', [['', 'any risk'], ['read', 'read'], ['write', 'write'], ['destructive', 'destructive']])}
          {sel('server_id', [['', 'any server'], ...servers.map((s: Any) => [s.id, s.name] as [string, string])])}
          {sel('agent_id', [['', 'any agent'], ...agents.map((a: Any) => [a.id, a.name] as [string, string])])}
          <button className="btn btn-primary btn-sm" onClick={apply}>Filter</button>
          <button className="btn btn-sm btn-ghost" onClick={() => { setDraft({}); setF({ limit: 50, offset: 0 }); }}>Clear</button>
          <span className="muted small" style={{ marginLeft: 'auto' }}>{num(res.total)} entries</span>
        </div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Actor</th><th>Tool</th><th>Risk</th><th>Status</th><th>Decision</th><th>Input</th><th className="td-r">ms</th></tr></thead>
        <tbody>{res.rows.length ? res.rows.map((r: Any) => (
          <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}>
            <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.created_at)}</td><td>{r.actor_type === 'user' ? '👤 ' + (r.user_name || '') : r.agent_name || '—'}</td>
            <td className="mono">{r.tool_name}</td><td><RiskPill r={r.risk} /></td><td><StatusPill s={r.status} /></td><td className="small" style={{ maxWidth: 260 }}>{r.decision_reason}</td>
            <td className="mono small" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.input_preview}</td><td className="td-r small">{r.duration_ms ?? ''}</td>
          </tr>)) : <tr><td colSpan={8}><Empty icon="📜" title="No entries" text="Try different filters or wait for agents to work." /></td></tr>}</tbody>
      </table></div>
      <div className="inline" style={{ marginTop: 12, justifyContent: 'center' }}>
        <button className="btn btn-sm" disabled={f.offset <= 0} onClick={() => setF({ ...f, offset: Math.max(0, f.offset - f.limit) })}>← Newer</button>
        <span className="muted small">{res.total ? f.offset + 1 : 0}–{Math.min(res.total, f.offset + res.limit)} of {num(res.total)}</span>
        <button className="btn btn-sm" disabled={f.offset + res.limit >= res.total} onClick={() => setF({ ...f, offset: f.offset + f.limit })}>Older →</button>
      </div>
      {open && <AuditDrawer id={open} onClose={() => setOpen(null)} />}
      {ai && <AiSummaryModal state={ai} total={res.total} onRun={summarize} onClose={() => setAi(null)} />}
    </>
  );
}

function AiSummaryModal({ state, total, onRun, onClose }: { state: { busy: boolean; text?: string }; total: number; onRun: (f: string) => void; onClose: () => void }) {
  const [focus, setFocus] = useState('');
  return (
    <Modal title="✨ Audit summary by Claude" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn btn-primary" disabled={state.busy} onClick={() => onRun(focus)}>Summarise {num(Math.min(120, total))} entries</button></>}>
      <Field label="Focus (optional)"><input className="input" value={focus} onChange={e => setFocus(e.target.value)} placeholder="e.g. anything risky in the last 24h?" /></Field>
      {state.busy && <div className="loading"><span className="spinner" /> Reading the log…</div>}
      {state.text && <div className="help" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{state.text}</div>}
    </Modal>
  );
}
