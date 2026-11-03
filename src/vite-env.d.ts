/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_GMCP_API_URL?: string;
  readonly VITE_GMCP_PUBLIC_HOST?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv; }
