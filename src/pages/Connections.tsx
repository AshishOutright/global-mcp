import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { PageHead } from '../components/Layout';
import { useSession } from '../components/Session';
import { Empty, ErrorCard, Field, Loading, Modal, Pill, StatusPill, useAsync, useConfirm, useToast } from '../components/ui';
import { ago, Any, connIcon, json } from '../lib/format';

function ConnectionForm({ existing, types, comingSoon, onClose, onDone }: { existing?: Any; types: Any; comingSoon: Any; onClose: () => void; onDone: () => void }) {
  const { fail } = useSession();
  const toast = useToast();
  const [type, setType] = useState<string>(existing?.type || 'github');
  const [name, setName] = useState(existing?.name || '');
  const [cfg, setCfg] = useState<Any>(existing?.config || {});
  const [sec, setSec] = useState<Any>({});
  const [busy, setBusy] = useState(false);
  const t = types[type];
  const value = (f: Any) => cfg[f.key] ?? f.default ?? '';
  const visible = (f: Any) => !f.show_if || Object.entries(f.show_if).every(([k, v]) => (cfg[k] ?? t.config.find((x: Any) => x.key === k)?.default) === v);
  const save = async () => {
    setBusy(true);
    const config: Any = {}; t.config.forEach((f: Any) => { config[f.key] = value(f); });
    try {
      const r = existing ? await api('connections.update', { id: existing.id, name, config, secret: sec }) : await api('connections.create', { type, name: name || t.label + ' connection', config, secret: sec });
      toast(r.status === 'active' ? 'Connection verified ✓' : 'Saved, but verification failed: ' + (r.last_error || ''), r.status === 'active' ? 'ok' : 'bad');
      onClose(); onDone();
    } catch (e) { fail(e); setBusy(false); }
  };
  return (
    <Modal title={existing ? 'Edit connection' : 'Add connection'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{existing ? 'Save & test' : 'Add & test'}</button></>}>
      {!existing && <div className="chips" style={{ marginBottom: 14 }}>
        {Object.entries(types).map(([k, v]: [string, Any]) => <button type="button" key={k} className={`chip ${k === type ? 'on' : ''}`} onClick={() => { setType(k); setCfg({}); }}>{connIcon(k)} {v.label}</button>)}
        {Object.values(comingSoon).slice(0, 3).map((v: Any) => <span key={v.label} className="chip dis">{v.label} · soon</span>)}
      </div>}
      <div className="help">{t.help}</div>
      <Field label="Name"><input className="input" value={name} placeholder={t.label + ' connection'} onChange={e => setName(e.target.value)} /></Field>
      {t.config.filter(visible).map((f: Any) => (
        <Field key={f.key} label={f.label} hint={f.hint}>
          {f.type === 'select'
            ? <select className="input" value={value(f)} onChange={e => setCfg({ ...cfg, [f.key]: e.target.value })}>{f.options.map((o: string[]) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>
            : <input className="input" value={value(f)} placeholder={f.placeholder || ''} onChange={e => setCfg({ ...cfg, [f.key]: e.target.value })} />}
        </Field>
      ))}
      {t.secret.map((f: Any) => (
        <Field key={f.key} label={f.label + (existing ? ' (leave blank to keep)' : '')}>
          <input className="input" type="password" autoComplete="new-password" placeholder={existing?.secret_masked?.[f.key] || ''} value={sec[f.key] || ''} onChange={e => setSec({ ...sec, [f.key]: e.target.value })} />
        </Field>
      ))}
    </Modal>
  );
}

export default function Connections() {
  const { me, isGuest, fail } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<Any | null>(null);
  const { data, error, reload } = useAsync(() => Promise.all([api('connections.list'), api('connections.types')]), []);
  if (error) return <ErrorCard error={error} />;
  if (!data) return <Loading />;
  const [list, T] = data;
  const u = me.usage.connections;
  const add = () => isGuest ? fail(new ApiError('Guests use the sample Acme connections. Log in to connect your real GitHub, Jira or CI.', 403, { login_required: true })) : setForm({});
  return (
    <>
      <PageHead title="Connections" text={<>Credentials for the systems your agents touch. Secrets are sealed and never shown again. <span className="muted">{u.used}/{u.limit} used</span></>} actions={<button className="btn btn-primary" onClick={add}>+ Add connection</button>} />
      {list.length ? (
        <div className="grid g3">{list.map((c: Any) => (
          <div className="card" key={c.id}>
            <div className="card-head"><h2>{connIcon(c.type)} {c.name}</h2><StatusPill s={c.status} /></div>
            <dl className="kv small">
              {c.type === 'github' && <><dt>Identity</dt><dd>{c.meta.login || '—'} {c.meta.scopes && <Pill>{c.meta.scopes}</Pill>}</dd><dt>API</dt><dd className="mono">{c.config.api_base}</dd></>}
              {c.type === 'jira' && <><dt>Site</dt><dd className="mono">{c.config.base_url}</dd><dt>Identity</dt><dd>{c.meta.display_name || c.config.email}</dd></>}
              {c.type === 'tests' && <><dt>Runner</dt><dd>{c.config.runner_type} {c.meta.workflow ? '· ' + c.meta.workflow : ''}</dd><dt>Target</dt><dd className="mono">{c.config.repo || c.config.run_url}</dd></>}
              <dt>Secret</dt><dd className="mono">{Object.values(c.secret_masked)[0] as string || '—'}</dd>
              <dt>Used by</dt><dd>{c.used_by.length ? c.used_by.map((s: Any) => s.name).join(', ') : <span className="muted">no server yet</span>}</dd>
              <dt>Checked</dt><dd>{ago(c.last_checked_at)}</dd>
            </dl>
            {c.config.demo && <div className="muted small" style={{ marginTop: 8 }}>Sample connection: answers with realistic demo data.</div>}
            {c.last_error && <div className="banner" style={{ marginTop: 10 }}>⚠ {c.last_error}</div>}
            <div className="inline" style={{ marginTop: 12 }}>
              <button className="btn btn-sm" onClick={async () => { try { const r = await api('connections.verify', { id: c.id }); toast('Connection works: ' + json(r.meta).slice(0, 80), 'ok'); } catch (e) { fail(e); } reload(); }}>Test</button>
              {!isGuest && <button className="btn btn-sm" onClick={() => setForm(c)}>Edit</button>}
              {!isGuest && <button className="btn btn-sm btn-ghost" onClick={async () => { if (await confirm({ title: 'Delete connection?', text: 'Servers bound to it must be unbound first.', ok: 'Delete', danger: true })) { try { await api('connections.delete', { id: c.id }); reload(); } catch (e) { fail(e); } } }}>Delete</button>}
            </div>
          </div>
        ))}</div>
      ) : <div className="card"><Empty icon="🔌" title="No connections yet" text="Add GitHub, Jira or a test runner to get started." action={<button className="btn btn-primary" onClick={add}>+ Add connection</button>} /></div>}
      <h3 style={{ margin: '26px 0 10px' }}>Coming soon</h3>
      <div className="grid g3">{Object.values(T.coming_soon).map((v: Any) => <div key={v.label} className="card soon" style={{ opacity: 0.8 }}><h3>{v.label}</h3><p className="sub small" style={{ marginTop: 4 }}>{v.desc}</p></div>)}</div>
      {form && <ConnectionForm existing={form.id ? form : undefined} types={T.types} comingSoon={T.coming_soon} onClose={() => setForm(null)} onDone={reload} />}
    </>
  );
}
