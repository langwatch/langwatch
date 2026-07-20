/**
 * The Codex provider mark: a terminal prompt in a rounded frame. An original
 * glyph (not OpenAI's trademarked logo) that reads as "coding agent" at grid
 * and table sizes; `currentColor` so it follows the surface's foreground.
 */
export function Codex(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <rect x="2.5" y="4" width="19" height="16" rx="3.2" />
      <path d="M7 9.5 10.5 12 7 14.5" />
      <path d="M12.5 15h4.5" />
    </svg>
  );
}
