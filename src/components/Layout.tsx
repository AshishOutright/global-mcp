import { ReactNode, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { MODE } from '../api/client';
import { useSession } from './Session';
import { Modal, useConfirm } from './ui';
import { Logo } from './Logo';

const NAV: ([string] | [string, string, string])[] = [
  ['Overview'], ['dashboard', 'Dashboard', '▦'], ['servers', 'MCP servers', '🛰️'], ['connections', 'Connections', '🔌'], ['agents', 'Agents & keys', '🔑'],
  ['Governance'], ['policies', 'Guardrails', '🛡️'], ['approvals', 'Approvals', '✅'], ['audit', 'Audit log', '📜'],
  ['Operate'], ['tests', 'Test runs', '🧪'], ['playground', 'Playground', '🎛️'], ['observability', 'Observability', '📡'],
  ['Account'], ['billing', 'Plan & billing', '💳'], ['settings', 'Settings', '⚙️'],
];

export const HELP: Record<string, [string, string, string[]]> = {
  dashboard: ['What am I looking at?', 'A live summary of what your AI agents did: how many actions they took, how many were blocked by your rules, and what is waiting for your approval.', ['Bars show activity per day (red part = blocked).', 'Click any row in <b>Recent activity</b> to see exactly what the agent sent and got back.']],
  servers: ['What is an MCP server?', 'The address your AI agent connects to, for example <code>/mcp/backend</code>. Each server decides which systems (GitHub, Jira, tests) and which tools the agent can see.', ['Create one per project or team.', 'Pick a rule set (policy) to protect it.', 'Then issue a key for each agent under <b>Agents &amp; keys</b>.']],
  connections: ['What is a connection?', "Your login details for GitHub, Jira or your test runner. Agents never see these: GMCP uses them on the agent's behalf, and only when your rules allow it.", ['GitHub: a personal access token.', 'Jira: site URL + email + API token.', 'Press <b>Test</b> to check it works.']],
  agents: ['What is an agent key?', "A password for one AI agent (for example Claude Code on one laptop). Every action is recorded under the key's name, and you can switch it off instantly.", ['<b>read</b>: can only look.', '<b>write</b>: can also create issues, branches and PRs.', '<b>admin</b>: can also merge and delete (still subject to approvals).']],
  policies: ['What are guardrails?', 'Rules that decide, for every single action, whether the agent may do it, may not, or must wait for a person.', ['Rules are checked top to bottom; the first match wins.', 'Protected branches (like <code>main</code>) need approval by default.', 'Use <b>Simulate</b> to check a rule set before using it.']],
  approvals: ['How do approvals work?', 'When an agent tries something risky (like merging), it waits here. Approve to run it with your name in the log, or reject it.', ['The agent is told to wait and checks back automatically.', 'Unanswered requests expire after 24 hours.']],
  audit: ['What is the audit log?', 'The full history: every action, who asked, what was sent, what came back, how long it took and which rule allowed or blocked it.', ['Filter by status, agent or server.', 'Click a row for full details.', 'Export to JSON for compliance.']],
  tests: ['Test runs', 'Test runs that agents start (for example before opening a pull request) on your GitHub Actions or CI.', ['Click a run to see its jobs and failures.']],
  playground: ['Try any tool yourself', 'Run a tool exactly like an agent would, through the same rules and log. Pick an agent key under <b>Act as</b> to see what that agent may do.', ['Choose a tool, edit the JSON arguments, press <b>Call tool</b>.']],
  observability: ['Monitoring', 'Send every action to your monitoring tool (Grafana, Datadog, Honeycomb…) using OpenTelemetry.', []],
  billing: ['Plans', 'Your limits and usage this month.', []],
  settings: ['Settings', 'Workspace name, team members, the Claude key for AI features, and security options.', []],
  docs: ['Connecting an agent', 'Copy the snippet for your tool and paste your agent key into it.', []],
};

const pageKey = (path: string) => path.replace(/^\/app\/?/, '').split('/')[0] || 'dashboard';

export function PageHead({ title, text, actions }: { title: ReactNode; text?: ReactNode; actions?: ReactNode }) {
  const { pathname } = useLocation();
  const { isGuest } = useSession();
  const k = pageKey(pathname);
  const h = HELP[k];
  const stored = (() => { try { return localStorage.getItem('gmcp-help-' + k); } catch { return null; } })();
  const [open, setOpen] = useState(stored === null ? isGuest : stored === '1');
  useEffect(() => { if (stored === null) setOpen(isGuest); }, [isGuest, stored]);
  const toggle = () => { setOpen(o => { try { localStorage.setItem('gmcp-help-' + k, o ? '0' : '1'); } catch { /* */ } return !o; }); };
  return (
    <>
      <div className="page-head">
        <div><h1>{title}{h && <button className="help-toggle" type="button" title="What is this?" aria-label="Help" onClick={toggle}>?</button>}</h1>{text && <p>{text}</p>}</div>
        <div className="actions">{actions}</div>
      </div>
      {h && open && (
        <div className="help-box"><b>{h[0]}</b><div style={{ marginTop: 4 }} dangerouslySetInnerHTML={{ __html: h[1] }} />{h[2].length > 0 && <ul>{h[2].map((x, i) => <li key={i} dangerouslySetInnerHTML={{ __html: x }} />)}</ul>}</div>
      )}
    </>
  );
}

function Tour({ onClose }: { onClose: () => void }) {
  const { isGuest } = useSession();
  const nav = useNavigate();
  const steps: [string, string, string][] = [
    ['🛰️', 'Welcome to GMCP', 'GMCP sits between your AI coding agents and GitHub, Jira and your tests. Agents get their own keys, and you decide what they may do.'],
    ['🛡️', 'You set the rules', 'Allow reading everything, allow opening pull requests, never touch <code>main</code>… Each action is checked against your rules before it happens.'],
    ['✅', 'Risky actions wait for you', 'Merges, deletes and writes to protected branches go to <b>Approvals</b>. One click to approve or reject.'],
    ['📜', 'Everything is recorded', 'The <b>Audit log</b> shows every action: who, what, when, result, and which rule decided.'],
    ['🎛️', isGuest ? 'Try it now' : 'Get started', isGuest ? 'Open the <b>Playground</b> and run <code>github_list_repos</code>, or approve a waiting request in <b>Approvals</b>.' : 'Add a connection, create a server, issue a key, and paste one command into Claude Code.'],
  ];
  const [i, setI] = useState(0);
  const done = (go?: boolean) => { try { localStorage.setItem('gmcp-tour-seen', '1'); } catch { /* */ } onClose(); if (go) nav(isGuest ? '/app/playground' : '/app/connections'); };
  const s = steps[i];
  return (
    <Modal title=" " onClose={() => done()} footer={<><button className="btn btn-ghost" onClick={() => done()}>Skip</button><button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button><button className="btn btn-primary" onClick={() => (i < steps.length - 1 ? setI(i + 1) : done(true))}>{i < steps.length - 1 ? 'Next' : isGuest ? 'Open Playground' : "Let's go"}</button></>}>
      <div className="tour"><div className="big">{s[0]}</div><h2>{s[1]}</h2><p dangerouslySetInnerHTML={{ __html: s[2] }} /><div className="tour-dots">{steps.map((_, j) => <i key={j} className={j === i ? 'on' : ''} />)}</div></div>
    </Modal>
  );
}

export default function Layout() {
  const { me, isGuest, logout } = useSession();
  const confirm = useConfirm();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const [tour, setTour] = useState(false);
  useEffect(() => { setMenu(false); window.scrollTo(0, 0); }, [pathname]);
  useEffect(() => { if (me) { let seen = false; try { seen = localStorage.getItem('gmcp-tour-seen') === '1'; } catch { /* */ } if (!seen) setTimeout(() => setTour(true), 500); } }, [me?.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTheme = () => { const n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; try { localStorage.setItem('gmcp-theme', n); } catch { /* */ } };
  const onLogout = async () => {
    if (await confirm({ title: isGuest ? 'Leave the demo?' : 'Log out?', text: isGuest ? 'Your sandbox is kept on this browser. You can come back as a guest anytime.' : 'You will be signed out.', ok: isGuest ? 'Leave' : 'Log out' })) logout();
  };
  if (!me) return <div className="loading" style={{ paddingTop: 120 }}><span className="spinner" /></div>;
  const initials = (me.user.name || 'U').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  const k = pageKey(pathname);
  const crumb = NAV.find(n => n[0] === k)?.[1] || (k === 'docs' ? 'Setup & docs' : 'Dashboard');

  return (
    <div className="app">
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <NavLink className="brand" to="/app"><Logo /><span className="brand-text"><strong>GMCP</strong><small>Global MCP</small></span></NavLink>
        <div className="ws-switch"><select aria-label="Workspace" value={me.workspace.id} onChange={() => undefined}>{me.workspaces.map((w: { id: string; name: string }) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
        <nav className="nav">
          {NAV.map((n, idx) => n.length === 1 ? <div className="nav-group" key={idx}>{n[0]}</div> : (
            <NavLink key={n[0]} to={'/app/' + n[0]} className={() => `nav-item ${k === n[0] ? 'active' : ''}`}>
              <span className="ico">{n[2]}</span><span>{n[1]}</span>{n[0] === 'approvals' && me.pending_approvals > 0 && <span className="cnt">{me.pending_approvals}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <NavLink className="nav-item" to="/app/docs"><span className="ico">📘</span><span>Setup &amp; docs</span></NavLink>
          <button className="nav-item" type="button" onClick={() => setTour(true)}><span className="ico">🧭</span><span>Take the tour</span></button>
          <button className="nav-item" type="button" onClick={toggleTheme}><span className="ico">◐</span><span>Theme</span></button>
          <button className="nav-item" type="button" onClick={onLogout}><span className="ico">⎋</span><span>{isGuest ? 'Leave demo' : 'Log out'}</span></button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Menu" type="button" onClick={() => setMenu(m => !m)}>☰</button>
          <div className="crumbs"><b>{crumb}</b></div>
          <div className="topbar-right">
            {MODE === 'demo' && <span className="pill pill-info" title="Running fully in your browser. Nothing is sent to a server.">Prototype</span>}
            {me.pending_approvals > 0 && <NavLink className="pill pill-warn" to="/app/approvals">⏳ <b>{me.pending_approvals}</b> approvals</NavLink>}
            <span className="plan-pill">{me.usage.plan.name} plan</span>
            <div className="avatar" title={me.user.name}>{initials}</div>
          </div>
        </header>
        {isGuest && (
          <div className="content" style={{ paddingBottom: 0 }}>
            <div className="guest-bar">👀 <span><b>You're exploring a demo sandbox.</b> Everything here is sample data, so click around freely.</span><button className="btn btn-primary btn-sm" onClick={() => nav('/?login=1')}>Log in to use your own GitHub &amp; Jira</button></div>
          </div>
        )}
        <main className="content"><Outlet /></main>
      </div>
      {tour && <Tour onClose={() => setTour(false)} />}
    </div>
  );
}
