const RAYS = [0, 45, 90, 135, 180, 225, 270, 315];

/** One button: the sun pulls in its rays and takes a bite to become the moon, and back. */
export function ThemeMenu() {
  return (
    <button
      type="button"
      data-docs-theme=""
      className="docs-theme-toggle"
      aria-label="Switch colour theme"
      title="Switch between light and dark"
    >
      <svg className="docs-theme-icon" viewBox="0 0 24 24" aria-hidden="true">
        <mask id="docs-moon-bite">
          <rect width="24" height="24" fill="white" />
          <circle className="docs-moon-bite" fill="black" />
        </mask>
        <circle className="docs-sun-core" cx="12" cy="12" fill="currentColor" mask="url(#docs-moon-bite)" />
        <g className="docs-sun-rays" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {RAYS.map((angle) => (
            <line key={angle} x1="12" y1="2.5" x2="12" y2="4.5" transform={`rotate(${angle} 12 12)`} />
          ))}
        </g>
      </svg>
    </button>
  );
}
