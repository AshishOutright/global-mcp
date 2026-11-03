import { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, MODE } from '../api/client';
import { Logo } from '../components/Logo';
import { Any } from '../lib/format';

const FEATURES = [
  ['🛰️', 'Managed MCP endpoints', 'One URL per project. Works with Claude Code, Codex, Cursor, Windsurf and any MCP client over Streamable HTTP.'],
  ['🐙', 'GitHub, Jira & test tools', '58 ready-made tools: issues, PRs, diffs, branches, Actions runs, JQL search, transitions, test runs and more.'],
  ['🛡️', 'Guardrails per call', 'Tool allow-lists, scoped keys, protected branches, allowed repos and projects, rate limits. First matching rule wins.'],
  ['✅', 'Human approvals', 'Merges, deletes and writes to protected branches wait for a person. One click to approve or reject.'],
  ['📜', 'Full audit log', 'Input, output, actor, decision, rule and latency for every call. Search, filter, export, AI summary.'],
  ['📡', 'OpenTelemetry', 'Stream every call as a span to Grafana, Datadog, Honeycomb or any OTLP collector.'],
];

export default function Landing() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [who, setWho] = useState<Any>(undefined);
  const [busy, setBusy] = useState<'' | 'guest' | 'login'>('');
  const [err, setErr] = useState('');
  const [showPw, setShowPw] = useState(false);
  const loginRef = useRef<HTMLDivElement>(null);
  const forceLogin = params.get('login') === '1';

  useEffect(() => { api('auth.whoami').then(setWho).catch(() => setWho(null)); }, []);
  useEffect(() => { if (forceLogin) loginRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [forceLogin]);

  const guest = async () => { setBusy('guest'); try { await api('auth.guest'); nav('/app'); } catch (e) { setErr((e as Error).message); setBusy(''); } };
  const login = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setErr(''); setBusy('login');
    const f = new FormData(e.currentTarget);
    try { await api('auth.login', { username: f.get('username'), password: f.get('password') }); nav('/app'); } catch (x) { setErr((x as Error).message); setBusy(''); }
  };
  const toggleTheme = () => { const n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; try { localStorage.setItem('gmcp-theme', n); } catch { /* */ } };
  const signedIn = who && !who.is_guest && !forceLogin;

  return (
    <div className="welcome">
      <div className="w-wrap">
        <header className="w-top">
          <div className="brand"><Logo /><span className="brand-text"><strong>GMCP</strong><small>Global MCP</small></span></div>
          <div className="inline">
            <a className="btn btn-ghost btn-sm" href="#features">Features</a>
            <a className="btn btn-ghost btn-sm" href="#how">How it works</a>
            <button className="icon-btn" type="button" aria-label="Switch theme" onClick={toggleTheme}>◐</button>
          </div>
        </header>

        <section className="w-hero">
          <span className="pill pill-lime">For teams using Claude Code, Codex &amp; Cursor</span>
          <h1>Let AI coding agents work in GitHub, Jira and your tests, <em>safely</em>.</h1>
          <p className="sub">Give each agent its own key, decide exactly what it may do, approve risky actions with one click, and keep a complete log of everything it did.</p>
        </section>

        <section className="w-choices">
          <div className="card w-card">
            <div className="w-ico">👀</div>
            <h2>Explore as a guest</h2>
            <p className="sub">No sign-up, no password. You get a private demo workspace with sample agents, rules and two weeks of activity to click through.</p>
            <ul className="w-list"><li>See the dashboard, audit log and approval queue</li><li>Create servers, keys and rules</li><li>Run tools in the Playground with sample data</li></ul>
            <button className="btn btn-lime w-btn" type="button" onClick={guest} disabled={!!busy}>{busy === 'guest' ? <><span className="spinner" /> Preparing your sandbox…</> : who?.is_guest ? 'Continue exploring →' : 'Start exploring →'}</button>
            <p className="muted small">{MODE === 'demo' ? 'Runs entirely in your browser. Nothing is sent anywhere.' : 'Your sandbox is kept for 30 days on this browser.'}</p>
          </div>

          <div className="card w-card" ref={loginRef}>
            <div className="w-ico">🔐</div>
            <h2>Log in</h2>
            {signedIn ? (
              <>
                <p className="sub">You're already signed in.</p>
                <button className="btn btn-primary w-btn" onClick={() => nav('/app')}>Continue as {who.name} →</button>
                <p className="muted small" style={{ marginTop: 12 }}>Not you? <a href="#" style={{ textDecoration: 'underline' }} onClick={async e => { e.preventDefault(); await api('auth.logout'); setWho(null); }}>Log in with another account</a></p>
              </>
            ) : (
              <form onSubmit={login} autoComplete="on">
                <p className="sub" style={{ marginBottom: 14 }}>{MODE === 'demo' ? 'Prototype: any username and password signs you in as a workspace owner, so you can try adding connections too.' : 'Use your OutrightCRM account to connect your real GitHub, Jira and test runners.'}</p>
                <div className="field"><label htmlFor="u">Username</label><input className="input" id="u" name="username" autoComplete="username" required /></div>
                <div className="field"><label htmlFor="p">Password</label><div className="w-pass"><input className="input" id="p" name="password" type={showPw ? 'text' : 'password'} autoComplete="current-password" required /><button type="button" className="w-eye" aria-label="Show password" onClick={() => setShowPw(s => !s)}>👁</button></div></div>
                {err && <div className="banner" role="alert">{err}</div>}
                <button className="btn btn-primary w-btn" type="submit" disabled={!!busy}>{busy === 'login' ? <><span className="spinner" /> Signing in…</> : 'Log in →'}</button>
              </form>
            )}
          </div>
        </section>

        <section className="w-how" id="how">
          <div className="w-step"><b>1</b><span><strong>Connect</strong> GitHub, Jira or your CI</span></div>
          <div className="w-step"><b>2</b><span><strong>Set rules</strong>: what agents may and may not do</span></div>
          <div className="w-step"><b>3</b><span><strong>Give each agent a key</strong> and paste one command</span></div>
          <div className="w-step"><b>4</b><span><strong>Watch &amp; approve</strong>: every action is logged</span></div>
        </section>

        <section id="features" style={{ marginTop: 56 }}>
          <h2 style={{ textAlign: 'center', fontSize: 26, marginBottom: 6 }}>Everything an agent integration needs</h2>
          <p className="sub" style={{ textAlign: 'center', marginBottom: 22 }}>Clean, reliable integrations with clear limits, and a record of everything.</p>
          <div className="grid g3">{FEATURES.map(([i, t, d]) => <div className="card" key={t}><div className="w-ico" style={{ marginBottom: 10 }}>{i}</div><h3>{t}</h3><p className="sub small" style={{ marginTop: 6 }}>{d}</p></div>)}</div>
        </section>

        <section className="grid g2" style={{ marginTop: 40, alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: 24 }}>One command to connect</h2>
            <p className="sub" style={{ margin: '8px 0 14px' }}>Issue a key, paste it into your agent, and every tool call flows through your guardrails and into the audit log.</p>
            <ul className="w-list"><li>Denied calls tell the agent <i>why</i>, so it can adapt</li><li>Approvals return a ticket the agent polls for the result</li><li>Agents can ask “what am I allowed to do?” before they try</li></ul>
          </div>
          <div className="code">{`$ claude mcp add --transport http gmcp \\
    https://gmcp.outrightcrm.in/mcp/backend \\
    --header "Authorization: Bearer gmcp_live_…"

> Fix ENG-142 and open a PR

● jira_get_issue ENG-142            ✓ allowed
● github_create_branch fix/ENG-142  ✓ allowed
● tests_run unit                    ✓ passed
● github_create_pull → main         ✓ allowed
● github_merge_pull #318            ⏳ waiting for approval`}</div>
        </section>

        <footer className="w-foot muted small">GMCP · managed MCP servers for AI coding agents · by OutrightCRM</footer>
      </div>
    </div>
  );
}
