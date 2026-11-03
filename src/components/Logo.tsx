export function Logo({ size = 34 }: { size?: number }) {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" width={size} height={size}><rect width="32" height="32" rx="9" fill="#1f2a24" /><path d="M9 22V10l7 7 7-7v12" stroke="#b8f06a" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
}
