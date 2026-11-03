import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, MODE } from '../api/client';
import { PageHead } from '../components/Layout';
import { useSession } from '../components/Session';
import { Drawer, Empty, ErrorCard, Field, Loading, Pill, RiskPill, StatusPill, useAsync, useToast } from '../components/ui';
import { AuditDrawer } from './Audit';
import { agentIcon, Any, connIcon, fmtDate, json } from '../lib/format';

// ---------------- Test runs ----------------
export function Tests() {
  const { fail } = useSession();
  const { data: list, error } = useAsync(() => api('tests.list'), []);
  const [run, setRun] = useState<Any>(null);
  if (error) return <ErrorCard error={error} />;
  if (!list) return <Loading />;
  const open = async (id: string) => { try { setRun(await api('tests.get', { id, refresh: 1 })); } catch (e) { fail(e); } };
  return (
    <>
      <PageHead title="Test runs" text="Runs triggered by agents (or from the playground) through the test-runner connector. Status is refreshed from GitHub Actions / your CI when you open a run." actions={<Link className="btn" to="/app/playground?tool=tests_run">▶ Trigger from playground</Link>} />
      <div className="card">{list.length ? (
        <div className="table-wrap"><table><thead><tr><th>Run</th><th>Runner</th><th>Status</th><th>Summary</th><th>Server / agent</th><th>Started</th><th>Finished</th><th /></tr></thead><tbody>
          {list.map((r: Any) => (
            <tr key={r.id} className="clickable" onClick={() => open(r.id)}>
              <td><b>{r.name || r.id.slice(0, 8)}</b><div className="muted small mono">{r.params?.ref} {r.params?.suite}</div></td><td>{r.runner_type}</td><td><StatusPill s={r.status} /></td>
              <td className="small">{r.summary?.jobs_total != null ? `${r.summary.jobs_passed}/${r.summary.jobs_total} jobs passed` : r.summary?.total != null ? `${r.summary.passed}/${r.summary.total} passed` : '—'}</td>
              <td className="small">{r.server_name || '—'}<div className="muted">{r.agent_name || 'user'}</div></td><td className="small">{fmtDate(r.started_at)}</td><td className="small">{fmtDate(r.finished_at)}</td>
              <td>{r.external_url && <a className="btn btn-xs" href={r.external_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>Open ↗</a>}</td>
            </tr>))}
        </tbody></table></div>
      ) : <Empty icon="🧪" title="No test runs yet" text="Add a test-runner connection, bind it to a server and call tests_run." />}</div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card soon"><h3>Flaky-test detection</h3><p className="sub small" style={{ marginTop: 4 }}>Compares reruns and flags tests that flip between passed and failed.</p></div>
        <div className="card soon"><h3>Auto-run on PR events</h3><p className="sub small" style={{ marginTop: 4 }}>Webhook-triggered runs when an agent opens or updates a pull request.</p></div>
      </div>
      {run && <Drawer onClose={() => setRun(null)}>
        <div className="card-head"><h2>{run.name || 'Run'}</h2><button className="icon-btn" onClick={() => setRun(null)}>✕</button></div>
        <div className="inline"><StatusPill s={run.status} /><Pill>{run.runner_type}</Pill>{run.external_url && <a className="btn btn-xs" href={run.external_url} target="_blank" rel="noopener noreferrer">Open in runner ↗</a>}</div>
        <h3 style={{ margin: '14px 0 6px' }}>Summary</h3><pre className="json">{json(run.summary)}</pre>
        <h3 style={{ margin: '14px 0 6px' }}>Params</h3><pre className="json">{json(run.params)}</pre>
        {run.logs && <><h3 style={{ margin: '14px 0 6px' }}>Logs</h3><pre className="json">{run.logs}</pre></>}
      </Drawer>}
    </>
  );
}

// ---------------- Playground ----------------
export function Playground() {
  const [params] = useSearchParams();
  const { data, error } = useAsync(() => Promise.all([api('servers.list'), api('agents.list'), api('tools.catalog')]), []);
  const [serverId, setServerId] = useState('');
  const [server, setServer] = useState<Any>(null);
  const [tool, setTool] = useState(params.get('tool') || '');
  const [agentId, setAgentId] = useState('');
  const [args, setArgs] = useState('{}');
  const [override, setOverride] = useState(false);
  const [out, setOut] = useState<Any>(null);
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<string | null>(null);
  const servers = data?.[0], agents = data?.[1], cat = data?.[2];
  useEffect(() => { if (servers?.length && !serverId) setServerId(servers[0].id); }, [servers, serverId]);
  useEffect(() => { if (serverId) api('servers.get', { id: serverId }).then(setServer); }, [serverId]);
  const tools: Any[] = server ? server.available_tools.filter((t: Any) => !server.tools.length || server.tools.includes(t.name)) : [];
  useEffect(() => { if (tools.length && !tools.some(t => t.name === tool)) setTool(tools.find(t => t.name === 'github_list_repos')?.name || tools[0].name); }, [server]); // eslint-disable-line react-hooks/exhaustive-deps
  const def = cat?.tools.find((t: Any) => t.name === tool);
  useEffect(() => {
    if (!def) return;
    const ex: Any = {};
    Object.entries(def.inputSchema.properties || {}).forEach(([k, p]: [string, Any]) => {
      if ((def.inputSchema.required || []).includes(k) || p.default !== undefined) ex[k] = p.default !== undefined ? p.default : p.type === 'integer' ? 1 : p.type === 'array' ? [] : p.type === 'object' ? {} : p.type === 'boolean' ? false : k === 'repo' ? 'acme/api' : k === 'issue_key' ? 'ENG-142' : '';
    });
    setArgs(json(ex));
  }, [tool, def]);
  if (error) return <ErrorCard error={error} />;
  if (!data) return <Loading />;
  if (!servers.length) return <><PageHead title="Playground" /><div className="card"><Empty icon="🎛️" title="Create a server first" text="The playground calls tools through a server exactly like an agent would." action={<Link className="btn btn-primary" to="/app/servers?new=1">Go to servers</Link>} /></div></>;
  const call = async () => {
    let a = {}; try { a = JSON.parse(args || '{}'); } catch { setOut({ status: 'error', error: 'Arguments must be valid JSON' }); return; }
    setBusy(true); const t0 = performance.now();
    try { const r = await api('playground.call', { server_id: serverId, agent_id: agentId || null, tool, args: a, override_approval: override ? 1 : 0 }); setOut({ ...r, ms: Math.round(performance.now() - t0) }); }
    catch (e) { setOut({ status: 'error', error: (e as Error).message }); }
    setBusy(false);
  };
  const st = out ? (out.status === 'ok' ? 'allowed' : out.status === 'approve' ? 'pending' : out.status) : null;
  return (
    <>
      <PageHead title="Playground" text={<>Call any tool as yourself through the same guardrails and audit log. Pick an agent key to test what <i>that</i> agent would be allowed to do.</>} />
      <div className="grid g32">
        <div className="card">
          <div className="row">
            <Field label="Server"><select className="input" value={serverId} onChange={e => setServerId(e.target.value)}>{servers.map((s: Any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Act as"><select className="input" value={agentId} onChange={e => setAgentId(e.target.value)}><option value="">👤 me (admin scope)</option>{agents.filter((a: Any) => a.status === 'active' && a.server_id === serverId).map((a: Any) => <option key={a.id} value={a.id}>{agentIcon(a.agent_type)} {a.name} ({a.scope})</option>)}</select></Field>
          </div>
          <Field label="Tool"><select className="input" value={tool} onChange={e => setTool(e.target.value)}>{tools.map(t => <option key={t.name} value={t.name}>{t.name} [{t.risk}]</option>)}</select></Field>
          {def && <div className="help small" style={{ marginBottom: 10 }}><RiskPill r={def.risk} /> {def.description}<div className="muted" style={{ marginTop: 4 }}>args: {Object.keys(def.inputSchema.properties || {}).map(k => <code key={k} style={{ marginRight: 6 }}>{k}</code>)}</div></div>}
          <Field label="Arguments (JSON)"><textarea className="input mono" rows={8} value={args} onChange={e => setArgs(e.target.value)} /></Field>
          <div className="inline"><button className="btn btn-primary" disabled={busy} onClick={call}>{busy ? <><span className="spinner" /> Calling…</> : '▶ Call tool'}</button><label className="check small"><input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} /> execute even if approval would be required</label></div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Result</h2>{out && <span className="sub small">{st && <StatusPill s={st} />} {out.ms} ms {out.audit_id && <> · <a href="#" onClick={e => { e.preventDefault(); setAudit(out.audit_id); }}>audit entry</a></>}</span>}</div>
          <pre className="json" style={{ maxHeight: 640 }}>{out ? json(out.status === 'ok' ? out.result : out) : 'Pick a tool and press Call.'}</pre>
        </div>
      </div>
      {audit && <AuditDrawer id={audit} onClose={() => setAudit(null)} />}
    </>
  );
}

// ---------------- Observability ----------------
export function Observability() {
  const { fail, isGuest } = useSession();
  const toast = useToast();
  const { data, error, reload } = useAsync(() => Promise.all([api('settings.get'), api('webhooks.list')]), []);
  const [f, setF] = useState<Any>(null);
  useEffect(() => { if (data) setF({ otel_enabled: data[0].otel_enabled === '1', otel_endpoint: data[0].otel_endpoint, otel_headers: data[0].otel_headers, otel_service_name: data[0].otel_service_name }); }, [data]);
  if (error) return <ErrorCard error={error} />;
  if (!data || !f) return <Loading />;
  const [st, wh] = data;
  const save = async () => { try { await api('settings.set', { values: { ...f, otel_enabled: f.otel_enabled ? '1' : '0' } }); toast('Saved', 'ok'); reload(); } catch (e) { fail(e); } };
  return (
    <>
      <PageHead title="Observability" text="Stream every audited tool call as an OpenTelemetry span to your collector (OTLP/HTTP JSON), and receive GitHub / Jira webhooks." />
      <div className="grid g2">
        <div className="card">
          <div className="card-head"><h2>📡 OpenTelemetry export</h2>{st.otel_enabled === '1' ? <Pill kind="pill-ok">enabled</Pill> : <Pill>off</Pill>}</div>
          <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={f.otel_enabled} onChange={e => setF({ ...f, otel_enabled: e.target.checked })} /> Export spans for every tool call</label>
          <Field label="OTLP endpoint"><input className="input" value={f.otel_endpoint} onChange={e => setF({ ...f, otel_endpoint: e.target.value })} placeholder="https://otlp.example.com:4318  (we append /v1/traces)" /></Field>
          <Field label="Headers (key=value per line)" hint="Stored encrypted. Works with Honeycomb, Grafana Tempo, Datadog, Jaeger, SigNoz, any OTLP collector."><textarea className="input mono" rows={3} value={f.otel_headers} onChange={e => setF({ ...f, otel_headers: e.target.value })} placeholder={'Authorization=Bearer …\nx-honeycomb-team=…'} /></Field>
          <Field label="Service name"><input className="input" value={f.otel_service_name} onChange={e => setF({ ...f, otel_service_name: e.target.value })} /></Field>
          <div className="inline"><button className="btn btn-primary" onClick={save} disabled={isGuest} title={isGuest ? 'Log in to change settings' : ''}>Save</button><button className="btn" onClick={async () => { try { const r = await api('otel.test'); toast('Collector answered HTTP ' + r.status, r.status < 300 ? 'ok' : 'bad'); } catch (e) { fail(e); } }}>Send test span</button></div>
          <h3 style={{ margin: '18px 0 6px' }}>Span attributes</h3>
          <div className="chips">{['mcp.tool.name', 'gmcp.status', 'gmcp.risk', 'gmcp.rule', 'gmcp.reason', 'gmcp.agent_id', 'gmcp.server_id', 'gmcp.session_id', 'client.address', 'gmcp.duration_ms'].map(a => <span key={a} className="chip mono" style={{ cursor: 'default' }}>{a}</span>)}</div>
          <p className="sub small" style={{ marginTop: 10 }}>Agents can propagate a W3C <code>traceparent</code> header; the audit span joins that trace.</p>
        </div>
        <div className="stack">
          <div className="card"><div className="card-head"><h2>🪝 Inbound webhooks</h2><Pill kind="pill-soon">feed live · automations coming soon</Pill></div>
            <p className="sub small">Point GitHub / Jira webhooks here with the secret from Settings. Events are stored and shown below; reacting to them (auto test runs, PR comments) ships next.</p>
            <dl className="kv small" style={{ marginTop: 10 }}><dt>GitHub</dt><dd className="mono">{wh.urls.github}</dd><dt>Jira</dt><dd className="mono">{wh.urls.jira}</dd></dl>
            {wh.events.length ? <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>Received</th><th>Source</th><th>Event</th></tr></thead><tbody>{wh.events.map((e: Any) => <tr key={e.id}><td className="small">{fmtDate(e.received_at)}</td><td>{connIcon(e.source)} {e.source}</td><td className="mono">{e.event_type}</td></tr>)}</tbody></table></div> : <p className="muted small" style={{ marginTop: 10 }}>No events received yet.</p>}
          </div>
          <div className="card soon"><h3>Alerts</h3><p className="sub small" style={{ marginTop: 4 }}>Email / Slack alerts on denial bursts, destructive attempts and approval requests.</p></div>
        </div>
      </div>
    </>
  );
}

// ---------------- Billing ----------------
export function Billing() {
  const { me, refresh, fail } = useSession();
  const toast = useToast();
  const { data: b, error, reload } = useAsync(() => api('billing.plans'), []);
  if (error) return <ErrorCard error={error} />;
  if (!b) return <Loading />;
  const u = b.usage;
  const bar = (k: string, label: string) => <div key={k}><div className="inline" style={{ justifyContent: 'space-between' }}><span className="small sub">{label}</span><span className="small"><b>{u[k].used.toLocaleString()}</b> / {u[k].limit.toLocaleString()}</span></div><div className="meter"><i style={{ width: Math.min(100, (u[k].used / u[k].limit) * 100) + '%' }} /></div></div>;
  const change = async (plan: string) => { try { await api('billing.change_plan', { plan }); await refresh(); toast('Plan changed', 'ok'); reload(); } catch (e) { fail(e); } };
  return (
    <>
      <PageHead title="Plan & billing" text={<>You are on the <b>{u.plan.name}</b> plan.{me.workspace.trial_ends_at ? ' Trial features until ' + fmtDate(me.workspace.trial_ends_at) + '.' : ''}</>} />
      <div className="card" style={{ marginBottom: 16 }}><div className="card-head"><h2>Usage this month</h2></div><div className="grid g4">{bar('calls_month', 'Tool calls')}{bar('servers', 'Servers')}{bar('connections', 'Connections')}{bar('agents', 'Agent keys')}</div></div>
      <div className="grid g4">{b.plans.map((p: Any) => (
        <div key={p.code} className={`card plan ${p.code === b.current ? 'current' : ''}`}>
          <div><h2>{p.name}</h2>{p.code === b.current && <Pill kind="pill-lime">current plan</Pill>}</div>
          <div className="price">{+p.price_month ? '$' + (+p.price_month).toFixed(0) : p.code === 'enterprise' ? 'Custom' : '$0'}<small>{+p.price_month ? '/month' : ''}</small></div>
          <ul><li>{p.limits.servers.toLocaleString()} servers · {p.limits.agents.toLocaleString()} keys</li><li>{p.limits.calls_month.toLocaleString()} calls / month</li><li>{p.limits.audit_days}-day audit retention</li>{p.features.map((x: string) => <li key={x}>{x}</li>)}</ul>
          <div style={{ marginTop: 'auto' }}>{p.code === b.current ? <button className="btn" disabled>Current</button> : p.code === 'enterprise' ? <a className="btn" href="mailto:sales@outrightcrm.com?subject=GMCP%20Enterprise">Contact sales</a> : <button className="btn btn-primary" onClick={() => change(p.code)}>Switch</button>}</div>
        </div>))}</div>
      <div className="banner info" style={{ marginTop: 16 }}>💳 Self-serve card checkout (Stripe / PayPal) is coming soon. Until then, plans are switched here or by <a href="mailto:sales@outrightcrm.com">contacting us</a>.</div>
    </>
  );
}

// ---------------- Settings ----------------
export function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = ['workspace', 'members', 'ai', 'security', 'system'].find(t => params.has(t)) || 'workspace';
  const { me, fail, refresh, isGuest } = useSession();
  const toast = useToast();
  const { data, error, reload } = useAsync(() => Promise.all([api('settings.get'), api('members.list'), api('system.status')]), []);
  const [v, setV] = useState<Any>({});
  useEffect(() => { if (data) setV({ name: me.workspace.name, ...data[0] }); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <ErrorCard error={error} />;
  if (!data) return <Loading />;
  const [st, mem, sys] = data;
  const save = async (values: Any, ws?: string) => { try { if (ws) await api('workspace.update', { name: ws }); await api('settings.set', { values }); await refresh(); toast('Saved', 'ok'); reload(); } catch (e) { fail(e); } };
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <>
      <PageHead title="Settings" />
      <div className="tabs">{[['workspace', 'Workspace'], ['members', 'Members'], ['ai', 'AI (Claude)'], ['security', 'Security'], ['system', 'System']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setParams(k === 'workspace' ? {} : { [k]: '' })}>{l}</button>)}</div>
      {isGuest && <div className="banner info">These settings are read-only in the demo sandbox. Log in to change them.</div>}
      {tab === 'workspace' && <div className="card" style={{ maxWidth: 640 }}>
        <Field label="Workspace name"><input className="input" value={v.name || ''} onChange={set('name')} /></Field>
        <dl className="kv small"><dt>Slug</dt><dd className="mono">{me.workspace.slug}</dd><dt>Owner</dt><dd>{me.user.name}</dd><dt>Your role</dt><dd>{me.role}</dd><dt>Created</dt><dd>{fmtDate(me.workspace.created_at)}</dd></dl>
        <Field label="Approval expiry (hours)" hint="Pending approvals older than this are marked expired."><input className="input" type="number" min={1} value={v.approval_ttl_hours || ''} onChange={set('approval_ttl_hours')} /></Field>
        <button className="btn btn-primary" onClick={() => save({ approval_ttl_hours: v.approval_ttl_hours }, v.name)}>Save</button>
      </div>}
      {tab === 'members' && <div className="card"><div className="card-head"><h2>Members</h2><span className="sub small">{me.usage.members.used}/{me.usage.members.limit} on your plan</span></div>
        <div className="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Since</th></tr></thead><tbody>{mem.members.map((m: Any) => <tr key={m.id}><td><b>{`${m.first_name || ''} ${m.last_name || ''}`.trim() || m.user_name}</b> <span className="muted small">{m.user_name}</span></td><td><Pill kind={m.role === 'owner' ? 'pill-lime' : ''}>{m.role}</Pill></td><td className="small">{fmtDate(m.created_at)}</td></tr>)}</tbody></table></div>
        <div className="card soon" style={{ marginTop: 14 }}><h3>Invite by email</h3><p className="sub small" style={{ marginTop: 4 }}>Invite teammates who don't have a CRM account yet.</p></div>
      </div>}
      {tab === 'ai' && <div className="card" style={{ maxWidth: 640 }}>
        <div className="card-head"><h2>Claude API</h2>{st.ai_configured ? <Pill kind="pill-ok">configured</Pill> : <Pill kind="pill-warn">not configured</Pill>}</div>
        <p className="sub small">Powers the AI policy builder and audit summaries. Your key is encrypted at rest and only used for this workspace.{MODE === 'demo' && ' In this prototype the AI features use a built-in stand-in.'}</p>
        <Field label="Anthropic API key"><input className="input" type="password" autoComplete="new-password" placeholder="sk-ant-…" value={v.anthropic_api_key || ''} onChange={set('anthropic_api_key')} /></Field>
        <Field label="Model" hint="Default: claude-sonnet-5-5"><input className="input" value={v.anthropic_model || ''} onChange={set('anthropic_model')} /></Field>
        <button className="btn btn-primary" onClick={() => save({ anthropic_api_key: v.anthropic_api_key, anthropic_model: v.anthropic_model })}>Save</button>
      </div>}
      {tab === 'security' && <div className="grid g2">
        <div className="card"><h2>Webhook secret</h2><p className="sub small" style={{ margin: '6px 0 10px' }}>Shared secret for GitHub (HMAC) and Jira (token) webhooks.</p>
          <Field label="Secret"><input className="input" type="password" autoComplete="new-password" value={v.webhook_secret || ''} onChange={set('webhook_secret')} /></Field>
          <button className="btn btn-primary" onClick={() => save({ webhook_secret: v.webhook_secret })}>Save</button></div>
        <div className="card"><h2>How secrets are protected</h2><ul className="sub small" style={{ margin: '8px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li>Connector tokens, OTLP headers and AI keys are sealed with libsodium secretbox.</li><li>Agent API keys are stored as SHA-256 hashes and shown once.</li>
          <li>Every MCP call is authenticated per key, scoped, policy-checked and audited before any upstream request.</li><li>Keys can expire, be rotated and be revoked instantly.</li></ul></div>
        <div className="card soon"><h3>SSO / SAML</h3><p className="sub small" style={{ marginTop: 4 }}>Enterprise sign-in for the dashboard.</p></div>
        <div className="card soon"><h3>IP allow-lists per key</h3><p className="sub small" style={{ marginTop: 4 }}>Restrict where an agent key may be used from.</p></div>
      </div>}
      {tab === 'system' && <div className="card"><div className="card-head"><h2>System</h2><span className="sub small">GMCP {sys.version}</span></div>
        <dl className="kv small"><dt>Mode</dt><dd>{MODE === 'demo' ? 'Prototype (data stored in this browser)' : 'Live backend'}</dd><dt>Site</dt><dd className="mono">{sys.site}</dd><dt>Audited calls</dt><dd>{sys.calls_total.toLocaleString()}</dd></dl>
        {MODE === 'demo' && <div className="inline" style={{ marginTop: 14 }}><button className="btn" onClick={async () => { await api('demo.reset'); await refresh(); toast('Demo data reset', 'ok'); reload(); }}>↺ Reset demo data</button></div>}
      </div>}
    </>
  );
}
