import { api } from '../api/client';
import { PageHead } from '../components/Layout';
import { Code, Loading, RiskPill, useAsync } from '../components/ui';
import { Any, connIcon } from '../lib/format';

export function ConnectSnippets({ endpoint, slug, apiKey = 'gmcp_live_<your key>' }: { endpoint: string; slug: string; apiKey?: string }) {
  const name = 'gmcp-' + slug;
  return (
    <div className="grid g2">
      <div className="card"><h2>Claude Code</h2><p className="sub small" style={{ margin: '6px 0 10px' }}>Project scope (<code>--scope project</code> writes <code>.mcp.json</code>) or user scope.</p>
        <Code text={`claude mcp add --transport http ${name} ${endpoint} \\\n  --header "Authorization: Bearer ${apiKey}"`} />
        <p className="sub small" style={{ marginTop: 10 }}>Then in Claude Code: <code>/mcp</code> to verify, and ask e.g. “list open PRs in acme/api”.</p></div>
      <div className="card"><h2>OpenAI Codex CLI</h2><p className="sub small" style={{ margin: '6px 0 10px' }}><code>~/.codex/config.toml</code></p>
        <Code text={`[mcp_servers.${name.replace(/-/g, '_')}]\nurl = "${endpoint}"\nhttp_headers = { Authorization = "Bearer ${apiKey}" }`} /></div>
      <div className="card"><h2>Cursor / Windsurf / VS Code</h2><p className="sub small" style={{ margin: '6px 0 10px' }}><code>.cursor/mcp.json</code>, <code>~/.codeium/windsurf/mcp_config.json</code> or <code>.vscode/mcp.json</code></p>
        <Code text={`{\n  "mcpServers": {\n    "${name}": {\n      "url": "${endpoint}",\n      "headers": { "Authorization": "Bearer ${apiKey}" }\n    }\n  }\n}`} /></div>
      <div className="card"><h2>Raw HTTP (any agent framework)</h2><p className="sub small" style={{ margin: '6px 0 10px' }}>Streamable HTTP, JSON-RPC 2.0. Keep the <code>Mcp-Session-Id</code> from <code>initialize</code>.</p>
        <Code text={`curl -s ${endpoint} \\\n  -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"gmcp_list_permissions","arguments":{}}}'`} /></div>
      <div className="card"><h2>Claude Agent SDK (Python)</h2>
        <Code text={`from claude_agent_sdk import query, ClaudeAgentOptions\n\nopts = ClaudeAgentOptions(mcp_servers={\n    "${name}": {"type": "http", "url": "${endpoint}",\n              "headers": {"Authorization": "Bearer ${apiKey}"}}\n})\nasync for msg in query(prompt="Triage ENG-42 and open a PR", options=opts):\n    print(msg)`} /></div>
      <div className="card"><h2>Agent hooks</h2><p className="sub small" style={{ margin: '6px 0 10px' }}>Optional Claude Code hook: block merges unless tests passed.</p>
        <Code text={`# .claude/settings.json\n{ "hooks": { "PreToolUse": [{ "matcher": "mcp__${name}__github_merge_pull",\n  "hooks": [{ "type": "command", "command": "scripts/require-green-tests.sh" }] }] } }`} /></div>
    </div>
  );
}

export default function Docs() {
  const { data } = useAsync(() => Promise.all([api('servers.list'), api('tools.catalog')]), []);
  if (!data) return <Loading />;
  const [servers, cat] = data;
  const s = servers[0];
  const groups: Record<string, Any[]> = {};
  cat.tools.forEach((t: Any) => (groups[t.connector] = groups[t.connector] || []).push(t));
  return (
    <>
      <PageHead title="Setup & docs" text="Connect any MCP-capable coding agent in one step. Keys are issued under Agents & keys." />
      <div className="card tint" style={{ marginBottom: 16 }}><h2>How a call flows</h2>
        <div className="grid g4" style={{ marginTop: 12 }}>{[['1 · Authenticate', 'Bearer key → agent, server, workspace, policy'], ['2 · Guardrails', 'allow-list → key scope → rules → constraints → rate limits'], ['3 · Execute or hold', 'allow runs upstream; approve parks it for a human; deny returns the reason'], ['4 · Audit + OTel', 'input, output, actor, decision, latency, trace ids']].map(([a, b]) => <div className="step" key={a}><span><b>{a}</b><small>{b}</small></span></div>)}</div></div>
      <ConnectSnippets endpoint={s ? s.endpoint : 'https://gmcp.outrightcrm.in/mcp/<server-slug>'} slug={s ? s.slug : 'server'} />
      <div className="card" style={{ marginTop: 16 }}><h2>HTTP test-runner contract</h2><p className="sub small" style={{ margin: '6px 0 10px' }}>Any CI can be a runner: implement two endpoints.</p>
        <div className="grid g2"><Code text={`POST {run_url}            Authorization: Bearer <token>\n{"run_id":"<gmcp id>","name":"PR #42","ref":"feature/x","suite":"unit","inputs":{}}\n→ 200 {"id":"ci-123","status":"queued","url":"https://ci/run/123"}`} />
          <Code text={`GET {status_url with {id}}\n→ 200 {"status":"passed|failed|running|queued|error",\n       "total":120,"passed":118,"failed":2,\n       "url":"…","logs":"optional text"}`} /></div></div>
      <div className="card" style={{ marginTop: 16 }}><h2>Tool catalog</h2><p className="sub small" style={{ margin: '6px 0 10px' }}>Everything a server can expose, by connector.</p>
        {Object.entries(groups).map(([k, ts]) => <div key={k}><h3 style={{ margin: '12px 0 6px' }}>{connIcon(k)} {k} <span className="muted small">{ts.length} tools</span></h3>
          <div className="tools-list">{ts.map(t => <div className="tool" key={t.name}><span><b>{t.name}</b> <RiskPill r={t.risk} /><small>{t.description}</small></span></div>)}</div></div>)}
        <h3 style={{ margin: '16px 0 6px' }}>Coming soon</h3><div className="chips">{Object.values(cat.coming_soon).map((c: Any) => <span key={c.label} className="chip dis">{c.label}</span>)}</div>
      </div>
    </>
  );
}
