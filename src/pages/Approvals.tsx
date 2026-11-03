import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { PageHead } from '../components/Layout';
import { useSession } from '../components/Session';
import { Empty, ErrorCard, Loading, RiskPill, StatusPill, useAsync, useToast } from '../components/ui';
import { agentIcon, ago, Any, fmtDate, json } from '../lib/format';

const TABS = ['pending', 'approved', 'rejected', 'expired', 'all'];

export default function Approvals() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find(t => params.has(t)) || 'pending';
  const { fail, refresh } = useSession();
  const toast = useToast();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const { data: list, error, reload } = useAsync(() => api('approvals.list', { status: tab === 'all' ? null : tab }), [tab]);
  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(id);
    try {
      const r = await api('approvals.decide', { id, decision, note: notes[id] || '' });
      if (decision === 'approve') toast(r.ok ? 'Approved and executed ✓' : 'Approved but execution failed: ' + r.error, r.ok ? 'ok' : 'bad'); else toast('Rejected');
      await refresh(); reload();
    } catch (e) { fail(e); } finally { setBusy(null); }
  };
  return (
    <>
      <PageHead title="Approvals" text={<>Human-in-the-loop queue. Approving runs the call as you, with your name in the audit log; the agent picks up the result via <code>gmcp_approval_status</code>.</>} />
      <div className="seg" style={{ marginBottom: 16 }}>{TABS.map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setParams(t === 'pending' ? {} : { [t]: '' })}>{t}</button>)}</div>
      {error ? <ErrorCard error={error} /> : !list ? <Loading /> : list.length === 0 ? (
        <div className="card"><Empty icon="✅" title="Queue is empty" text={tab === 'pending' ? 'Calls that need a human land here.' : 'Nothing with this status.'} /></div>
      ) : (
        <div className="stack">{list.map((a: Any) => (
          <div className="card" key={a.id}>
            <div className="card-head">
              <div><h2><RiskPill r={a.risk} /> <span className="mono">{a.tool_name}</span></h2>
                <div className="sub small" style={{ marginTop: 4 }}>{agentIcon(a.agent_type)} {a.agent_name} · {a.server_name} · requested {ago(a.requested_at)}{a.expires_at && a.status === 'pending' ? ' · expires ' + fmtDate(a.expires_at) : ''}</div></div>
              <StatusPill s={a.status} />
            </div>
            <div className="banner info" style={{ margin: '0 0 10px' }}>{a.reason}</div>
            <pre className="json">{json(a.input)}</pre>
            {a.status === 'pending' ? (
              <div className="inline" style={{ marginTop: 12 }}>
                <input className="input" placeholder="Note (optional)" style={{ maxWidth: 360 }} value={notes[a.id] || ''} onChange={e => setNotes({ ...notes, [a.id]: e.target.value })} />
                <button className="btn btn-lime" disabled={busy === a.id} onClick={() => decide(a.id, 'approve')}>✓ Approve &amp; run</button>
                <button className="btn btn-danger" disabled={busy === a.id} onClick={() => decide(a.id, 'reject')}>Reject</button>
              </div>
            ) : (
              <>
                <div className="sub small" style={{ marginTop: 10 }}>{a.status} by {a.decided_by_name || '—'} {a.decided_at ? ago(a.decided_at) : ''}{a.decision_note ? ' · ' + a.decision_note : ''}</div>
                {a.result && <details style={{ marginTop: 8 }}><summary className="small sub" style={{ cursor: 'pointer' }}>Result</summary><pre className="json">{json(a.result)}</pre></details>}
              </>
            )}
          </div>
        ))}</div>
      )}
    </>
  );
}
