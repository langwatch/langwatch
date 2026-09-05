import { useMemo } from "react";
import { encode } from "uqr";

/**
 * The scannable setup code, drawn rather than defaulted.
 *
 * Two decisions in here, and the first is not aesthetic: the ink is a FIXED
 * near-black on the white tile the parent provides, in both themes. A code
 * that follows the theme's foreground goes light-on-white in dark mode —
 * which is exactly the all-but-invisible square this replaced — and scanners
 * want dark modules on a light ground anyway.
 *
 * The second is the look: round modules, with the three finder squares drawn
 * as rounded rings so the corners read as designed rather than generated.
 * Both stay comfortably inside what scanners tolerate — the dot radius keeps
 * neighbouring modules visually joined enough to register, and the finder
 * geometry (1:1:3:1:1) is preserved exactly, only its corners are rounded.
 */

const INK = "#141417";
/** Radius of one module, in cell units. 0.38 keeps adjacent dots touching
 *  enough for scanners while still reading as circles. */
const DOT_RADIUS = 0.38;

export function StyledQrCode({
  value,
  size = 200,
}: {
  value: string;
  size?: number;
}) {
  const qr = useMemo(() => encode(value, { ecc: "M", border: 0 }), [value]);
  const n = qr.size;

  const inFinder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);

  const dots: string[] = [];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (qr.data[y]?.[x] && !inFinder(x, y)) {
        dots.push(`M ${x + 0.5 + DOT_RADIUS} ${y + 0.5}
          a ${DOT_RADIUS} ${DOT_RADIUS} 0 1 0 ${-DOT_RADIUS * 2} 0
          a ${DOT_RADIUS} ${DOT_RADIUS} 0 1 0 ${DOT_RADIUS * 2} 0`);
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      role="img"
      aria-label="Scannable setup code"
    >
      {/* One path for every module: thousands of circle elements would make
          this the heaviest node on the page for no visual gain. */}
      <path d={dots.join(" ")} fill={INK} />
      <Finder x={0} y={0} />
      <Finder x={n - 7} y={0} />
      <Finder x={0} y={n - 7} />
    </svg>
  );
}

/** One 7×7 finder square: a rounded ring and a rounded core, keeping the
 *  1:1:3:1:1 proportions scanners lock onto. */
function Finder({ x, y }: { x: number; y: number }) {
  return (
    <g fill="none">
      <rect
        x={x + 0.5}
        y={y + 0.5}
        width={6}
        height={6}
        rx={2.1}
        stroke={INK}
        strokeWidth={1}
      />
      <rect x={x + 2} y={y + 2} width={3} height={3} rx={1.1} fill={INK} />
    </g>
  );
}
