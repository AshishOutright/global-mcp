import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { PageHead } from '../components/Layout';
import { useSession } from '../components/Session';
import { Empty, ErrorCard, Loading, Meter, Pill, StatusPill, useAsync } from '../components/ui';
import { AuditDrawer } from './Audit';
import { agentIcon, ago, Any, num } from '../lib/format';

function CallsChart({ byDay }: { byDay: Any[] }) {
  const days: { d: string; n: number; denied: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const r = byDay.find(x => x.d === d);
    days.push({ d, n: r ? +r.n : 0, denied: r ? +r.denied : 0 });
  }
  const max = Math.max(1, ...days.map(x => x.n));
  const W = 560, H = 140, bw = W / days.length;
  const [tip, setTip] = useState<{ x: number; y: number; t: string } | null>(null);
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H + 24}`} preserveAspectRatio="none" role="img" aria-label="Tool calls per day, last 14 days">
        {[0, 0.5, 1].map(f => <line key={f} className="grid" x1="0" x2={W} y1={H - f * H} y2={H - f * H} />)}
        {days.map((x, i) => {
          const h = Math.max(x.n ? 3 : 0, (x.n / max) * H), dh = Math.max(x.denied ? 2 : 0, (x.denied / max) * H);
          const show = (e: React.MouseEvent<SVGRectElement>) => { const b = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect(); setTip({ x: e.clientX - b.left, y: e.clientY - b.top, t: `${x.d}: ${x.n} calls, ${x.denied} denied` }); };
          return (
            <g key={x.d}>
              <rect className="bar" x={i * bw + bw * 0.2} y={H - h} width={bw * 0.6} height={h} rx="3" onMouseMove={show} />
              {x.denied > 0 && <rect className="bar denied" x={i * bw + bw * 0.2} y={H - dh} width={bw * 0.6} height={dh} rx="2" onMouseMove={show} />}
              {i % 3 === 0 && <text className="axis" x={i * bw + bw / 2} y={H + 16} textAnchor="middle">{x.d.slice(5)}</text>}
            </g>
          );
        })}
      </svg>
      {tip && <div className="tip" style={{ left: tip.x, top: tip.y }}>{tip.t}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { me, isGuest } = useSession();
  const { data: d, error, loading } = useAsync(() => api('dashboard'), []);
  const [audit, setAudit] = useState<string | null>(null);
  if (error) return <ErrorCard error={error} />;
  if (loading || !d) return <Loading />;
  const c = d.counts, u = d.usage, st = d.stats;
  const steps = [
    { done: c.connections > 0, t: 'Connect GitHub, Jira or a test runner', s: 'Credentials are encrypted at rest', to: '/app/connections' },
    { done: c.servers > 0, t: 'Create an MCP server', s: 'Bind connections, pick tools, attach a guardrail policy', to: '/app/servers' },
    { done: c.agents > 0, t: 'Issue an agent key', s: 'Scoped read / write / admin, with expiry', to: '/app/agents' },
    { done: st.by_status.length > 0, t: 'Connect Claude Code, Codex or Cursor', s: 'One command, see Setup & docs', to: '/app/docs' },
  ];
  return (
    <>
      <PageHead title="Dashboard" text={isGuest ? <>Sample data from a fictional company, <b>Acme</b>, whose AI agents work on its API repo and Jira board.</> : <>Workspace <b>{me.workspace.name}</b> · {u.plan.name} plan</>}
        actions={<><Link className="btn" to="/app/playground">🎛️ Playground</Link><Link className="btn btn-primary" to="/app/servers?new=1">+ New server</Link></>} />
      {!steps.every(s => s.done) && (
        <div className="hero">
          <div className="card tint"><h2>Get your first agent connected</h2><p className="sub" style={{ margin: '6px 0 14px' }}>Four steps, about five minutes.</p>
            <div className="steps">{steps.map((s, i) => <Link key={i} className={`step ${s.done ? 'done' : ''}`} to={s.to}><span className="n">{s.done ? '✓' : i + 1}</span><span><b>{s.t}</b><small>{s.s}</small></span></Link>)}</div></div>
          <div className="card dark"><h2 style={{ color: 'inherit' }}>What GMCP does</h2><p className="muted" style={{ marginTop: 8 }}>A managed MCP endpoint per project. Your coding agents get <b>Jira, GitHub and test tools</b> behind explicit allow-lists, scoped keys, rate limits and human approvals, and every call lands in an audit log.</p></div>
        </div>
      )}
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="label">Tool calls · 24h</div><div className="value">{num(c.calls_24h)}</div><div className="delta">{num(u.calls_month.used)} / {num(u.calls_month.limit)} this month</div><Meter used={u.calls_month.used} limit={u.calls_month.limit} /></div>
        <div className="card stat"><div className="label">Denied by guardrails · 24h</div><div className={`value ${c.denied_24h ? 'bad' : ''}`}>{num(c.denied_24h)}</div><div className="delta">p95 latency {num(st.p95_ms)} ms</div></div>
        <div className="card stat"><div className="label">Pending approvals</div><div className={`value ${c.pending_approvals ? 'warn' : ''}`}>{num(c.pending_approvals)}</div><div className="delta"><Link to="/app/approvals">Review queue →</Link></div></div>
        <div className="card stat"><div className="label">Active sessions · 1h</div><div className="value">{num(c.sessions_active)}</div><div className="delta">{c.agents} keys · {c.servers_active}/{c.servers} servers live{c.tests_running ? ` · ${c.tests_running} tests running` : ''}</div></div>
      </div>
      <div className="grid g23" style={{ marginBottom: 16 }}>
        <div className="card"><div className="card-head"><h2>Tool calls · last 14 days</h2><span className="sub"><span className="dot ok" /> calls &nbsp; <span className="dot bad" /> denied</span></div><CallsChart byDay={st.by_day} /></div>
        <div className="card"><div className="card-head"><h2>Top tools · 30d</h2></div>
          {st.top_tools.length ? <div className="bars">{st.top_tools.map((t: Any) => <div className="r" key={t.tool_name}><span className="mono" title={t.tool_name} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.tool_name}</span><div className="track"><div className="fill" style={{ width: (t.n / st.top_tools[0].n) * 100 + '%' }} /></div><span className="td-r">{num(t.n)}</span></div>)}</div>
            : <Empty icon="📭" title="No calls yet" text="Connect an agent and the activity shows up here." />}
        </div>
      </div>
      <div className="grid g32">
        <div className="card"><div className="card-head"><h2>Recent activity</h2><Link className="btn btn-sm" to="/app/audit">Full audit log</Link></div>
          {st.recent.length ? <div className="table-wrap"><table><thead><tr><th>When</th><th>Agent</th><th>Tool</th><th>Status</th><th className="td-r">ms</th></tr></thead><tbody>
            {st.recent.map((r: Any) => <tr key={r.id} className="clickable" onClick={() => setAudit(r.id)}><td className="small">{ago(r.created_at)}</td><td>{r.agent_name || r.user_name || '—'}</td><td className="mono">{r.tool_name}</td><td><StatusPill s={r.status} /></td><td className="td-r small">{r.duration_ms ?? '—'}</td></tr>)}
          </tbody></table></div> : <Empty icon="🛰️" title="Quiet so far" text="Tool calls from your agents appear here in real time." />}
        </div>
        <div className="stack">
          <div className="card"><div className="card-head"><h2>Servers</h2><Link className="btn btn-sm" to="/app/servers">Manage</Link></div>
            {d.servers.length ? d.servers.map((s: Any) => <Link key={s.id} className="tl" to={'/app/servers/' + s.id}><span className="mono small">/mcp/{s.slug}</span><span><b>{s.name}</b> <span className="muted small">· {s.tools_exposed} tools · {num(s.calls_total)} calls</span></span><StatusPill s={s.status} /></Link>) : <p className="sub">No servers yet.</p>}</div>
          <div className="card"><div className="card-head"><h2>Awaiting approval</h2></div>
            {d.pending.length ? d.pending.map((p: Any) => <Link key={p.id} className="tl" to="/app/approvals"><span className="small">{ago(p.requested_at)}</span><span><span className="mono">{p.tool_name}</span> <span className="muted small">by {p.agent_name}</span></span><Pill kind="pill-warn">review</Pill></Link>) : <p className="sub">Nothing waiting on you. 🎉</p>}</div>
          <div className="card"><div className="card-head"><h2>Top agents · 30d</h2></div>
            {st.top_agents.length ? st.top_agents.map((a: Any) => <div className="tl" key={a.name}><span>{agentIcon(a.agent_type)} {a.name}</span><span className="small muted">{num(a.n)} calls</span>{+a.denied ? <Pill kind="pill-bad">{a.denied} denied</Pill> : <Pill kind="pill-ok">clean</Pill>}</div>) : <p className="sub">No agent activity yet.</p>}</div>
        </div>
      </div>
      {audit && <AuditDrawer id={audit} onClose={() => setAudit(null)} />}
    </>
  );
}
