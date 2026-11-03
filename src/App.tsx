import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { SessionProvider } from './components/Session';
import { ConfirmProvider, ToastProvider } from './components/ui';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Servers, { ServerDetail } from './pages/Servers';
import Connections from './pages/Connections';
import Agents from './pages/Agents';
import Policies from './pages/Policies';
import Approvals from './pages/Approvals';
import Audit from './pages/Audit';
import Docs from './pages/Docs';
import { Billing, Observability, Playground, Settings, Tests } from './pages/Operate';

// HashRouter: deep links work on static hosts (GitHub Pages) without server rewrites.
export default function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/app" element={<SessionProvider><Layout /></SessionProvider>}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="servers" element={<Servers />} />
              <Route path="servers/:id" element={<ServerDetail />} />
              <Route path="connections" element={<Connections />} />
              <Route path="agents" element={<Agents />} />
              <Route path="policies" element={<Policies />} />
              <Route path="approvals" element={<Approvals />} />
              <Route path="audit" element={<Audit />} />
              <Route path="tests" element={<Tests />} />
              <Route path="playground" element={<Playground />} />
              <Route path="observability" element={<Observability />} />
              <Route path="billing" element={<Billing />} />
              <Route path="settings" element={<Settings />} />
              <Route path="docs" element={<Docs />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </HashRouter>
  );
}
