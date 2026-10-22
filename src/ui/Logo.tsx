/** Ready's mark, re-cut as a shelf: three spines, one leaning, and the print-signal dot. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" className="logo-mark" aria-hidden>
      <rect x="1" y="1" width="24" height="24" rx="5" fill="currentColor" />
      <rect x="5" y="5" width="4" height="16" rx="1" fill="var(--logo-ink)" />
      <rect x="10.5" y="7" width="4" height="14" rx="1" fill="var(--logo-ink)" opacity=".55" />
      <rect x="16" y="9.5" width="4" height="11.5" rx="1" transform="rotate(-14 18 15)" fill="var(--logo-ink)" />
      <circle cx="19.5" cy="6.5" r="2.6" fill="var(--accent)" />
    </svg>
  );
}

export const Wordmark = () => <span className="wordmark">Ready <i>Library</i></span>;
