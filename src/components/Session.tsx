import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Any } from '../lib/format';
import { Modal, useToast } from './ui';

interface SessionCtx {
  me: Any | null;
  refresh: () => Promise<void>;
  isGuest: boolean;
  /** Show errors nicely: login-required → friendly dialog, anything else → toast */
  fail: (e: unknown) => void;
  logout: () => Promise<void>;
}
const Ctx = createContext<SessionCtx>({ me: null, refresh: async () => undefined, isGuest: false, fail: () => undefined, logout: async () => undefined });
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Any | null>(null);
  const [loginMsg, setLoginMsg] = useState<string | null>(null);
  const toast = useToast();
  const nav = useNavigate();

  const refresh = useCallback(async () => {
    try { setMe(await api('me')); } catch (e) { if (e instanceof ApiError && e.status === 401) nav('/'); else throw e; }
  }, [nav]);

  useEffect(() => { refresh().catch(() => undefined); const t = setInterval(() => refresh().catch(() => undefined), 60000); return () => clearInterval(t); }, [refresh]);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.data?.login_required) { setLoginMsg(e.message); return; }
    if (e instanceof ApiError && e.status === 401) { nav('/'); return; }
    if (!(e instanceof ApiError)) console.error(e); // expected API errors are shown, not logged
    toast((e as Error)?.message || String(e), 'bad');
  }, [toast, nav]);

  const logout = useCallback(async () => { try { await api('auth.logout'); } catch { /* ignore */ } setMe(null); nav('/'); }, [nav]);

  return (
    <Ctx.Provider value={{ me, refresh, isGuest: !!me?.is_guest, fail, logout }}>
      {children}
      {loginMsg && (
        <Modal title="Log in to do this" onClose={() => setLoginMsg(null)} footer={<><button className="btn" onClick={() => setLoginMsg(null)}>Keep exploring</button><button className="btn btn-primary" onClick={() => { setLoginMsg(null); nav('/?login=1'); }}>Log in</button></>}>
          <div className="tour"><div className="big">🔐</div><p>{loginMsg}</p><p className="small" style={{ marginTop: 10 }}>Your demo sandbox stays here if you come back as a guest.</p></div>
        </Modal>
      )}
    </Ctx.Provider>
  );
}
