import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Any } from '../lib/format';

// ---------- small presentational pieces ----------

export const Pill = ({ children, kind = '' }: { children: ReactNode; kind?: string }) => <span className={`pill ${kind}`}>{children}</span>;

const STATUS: Record<string, [string, string]> = {
  allowed: ['✓ allowed', 'pill-ok'], approved: ['✓ approved', 'pill-ok'], denied: ['⛔ denied', 'pill-bad'], error: ['⚠ error', 'pill-bad'], pending: ['⏳ pending', 'pill-warn'],
  rejected: ['✕ rejected', 'pill-bad'], running: ['… running', 'pill-info'], expired: ['expired', ''], active: ['● active', 'pill-ok'], paused: ['❚❚ paused', 'pill-warn'],
  revoked: ['revoked', 'pill-bad'], unverified: ['unverified', 'pill-warn'], queued: ['queued', 'pill-info'], passed: ['✓ passed', 'pill-ok'], failed: ['✕ failed', 'pill-bad'], cancelled: ['cancelled', ''],
};
export const StatusPill = ({ s }: { s: string }) => { const [t, k] = STATUS[s] || [s, '']; return <Pill kind={k}>{t}</Pill>; };
export const RiskPill = ({ r }: { r: string }) => <Pill kind={'risk-' + r}>{r}</Pill>;
export const EffectPill = ({ e }: { e: string }) => <Pill kind={e === 'allow' ? 'pill-ok' : e === 'deny' ? 'pill-bad' : 'pill-warn'}>{e}</Pill>;

export const Empty = ({ icon, title, text, action }: { icon: string; title: string; text: string; action?: ReactNode }) => (
  <div className="empty"><div className="big">{icon}</div><b>{title}</b><div>{text}</div>{action && <div style={{ marginTop: 14 }}>{action}</div>}</div>
);

export const Loading = () => <div className="loading"><span className="spinner" /></div>;

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <div className="field"><label>{label}</label>{children}{hint && <div className="hint">{hint}</div>}</div>;
}

export function Code({ text }: { text: string }) {
  const toast = useToast();
  return <div className="code"><button className="copy" type="button" onClick={() => navigator.clipboard.writeText(text).then(() => toast('Copied'))}>Copy</button>{text}</div>;
}

export function CopyButton({ text, label = '⧉', className = 'btn btn-xs' }: { text: string; label?: string; className?: string }) {
  const toast = useToast();
  return <button type="button" className={className} onClick={() => navigator.clipboard.writeText(text).then(() => toast('Copied'))}>{label}</button>;
}

export function Meter({ used, limit }: { used: number; limit: number }) {
  const p = limit ? used / limit : 0;
  return <div className="meter"><i className={p >= 1 ? 'bad' : p >= 0.8 ? 'warn' : ''} style={{ width: Math.min(100, p * 100) + '%' }} /></div>;
}

// ---------- toasts ----------

type ToastFn = (msg: string, kind?: '' | 'ok' | 'bad') => void;
const ToastCtx = createContext<ToastFn>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const push = useCallback<ToastFn>((msg, kind = '') => {
    const id = Date.now() + Math.random();
    setItems(x => [...x, { id, msg, kind }]);
    setTimeout(() => setItems(x => x.filter(t => t.id !== id)), kind === 'bad' ? 6000 : 3200);
  }, []);
  return <ToastCtx.Provider value={push}>{children}{createPortal(<div className="toasts" aria-live="assertive">{items.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>, document.body)}</ToastCtx.Provider>;
}

// ---------- modal & drawer ----------

export function Modal({ title, children, footer, wide, onClose }: { title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return createPortal(
    <div className="modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>, document.body);
}

export function Drawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return createPortal(<><div className="drawer-bg" onClick={onClose} /><div className="drawer">{children}</div></>, document.body);
}

/** Imperative confirm dialog: const ok = await confirm({...}) */
type ConfirmOpts = { title: string; text: string; ok?: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<(v: boolean) => void>();
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>(res => { resolver.current = res; setOpts(o); }), []);
  const done = (v: boolean) => { resolver.current?.(v); setOpts(null); };
  return <ConfirmCtx.Provider value={ask}>{children}{opts && (
    <Modal title={opts.title} onClose={() => done(false)} footer={<><button className="btn" onClick={() => done(false)}>Cancel</button><button className={`btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => done(true)}>{opts.ok || 'Confirm'}</button></>}>
      <p className="sub">{opts.text}</p>
    </Modal>)}</ConfirmCtx.Provider>;
}

// ---------- data hook ----------

export function useAsync<T = Any>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true; setLoading(true);
    fn().then(d => { if (alive) { setData(d); setError(null); } }).catch(e => { if (alive) setError(e); }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick(t => t + 1), setData };
}

export function ErrorCard({ error }: { error: Error }) {
  return <div className="card"><h2>Something went wrong</h2><p className="sub" style={{ marginTop: 8 }}>{error.message}</p></div>;
}
