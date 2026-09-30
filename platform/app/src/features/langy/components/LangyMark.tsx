import { Box } from "@chakra-ui/react";
import { LOGO_LINES_PATH } from "~/components/icons/LogoIcon";
import { useReducedMotion } from "~/hooks/useReducedMotion";

/**
 * Langy's mark: LangWatch's own logo, repainted in the brand gradient.
 *
 * It used to be a generic 4-point sparkle — the same "AI" glyph every product
 * ships. Langy is LangWatch, so it wears LangWatch's face: the isometric box
 * from `~/components/icons/LogoIcon`, drawn from the same path data.
 *
 * Two changes to the artwork, both deliberate:
 *   - the white backing plate (LogoIcon's first path) is dropped, so the box's
 *     faces are the panel showing through rather than a white slab punched into
 *     a cream/ink surface;
 *   - the remaining path — the silhouette and its interior wireframe, one
 *     compound path — is filled with the brand gradient instead of #213B41.
 *
 * LEGIBILITY: the wireframe's interior lines are ~1.5 viewBox units on a 38×52
 * box, so they thin out fast — below roughly 22px of mark height they stop
 * reading as a box and start reading as a smudge. This is why the mark is NOT
 * used as a chat avatar: at the 24–30px those slots allow, minus tile padding,
 * the logo would be a smear. It appears only where it has room — the launcher
 * (26px) and the empty state's hero (44px).
 */

/** Own paint server, so it can never collide with another gradient def on the page. */
export const LANGY_MARK_GRADIENT_ID = "langy-brand-mark-grad";

/** The AI accent shadow under Langy's primary (apply) action — brand purple. */
export const LANGY_ACTION_SHADOW = "0 6px 18px -4px rgba(168, 85, 247, 0.35)";

// The mark's natural proportions (from LogoIcon's viewBox).
const MARK_VIEWBOX_WIDTH = 38;
const MARK_VIEWBOX_HEIGHT = 52;

/**
 * Hidden SVG defining Langy's gradient paint server. Rendered once at the root
 * of the Langy tree. It carries `.langy-root` itself because SVG stops resolve
 * custom properties against their OWN cascade, not the referencing element's —
 * without the class the `--langy-ai-*` vars would be undefined here and the
 * mark would fall back to its literal defaults.
 */
export function LangyMarkGradientDefs({
  id = LANGY_MARK_GRADIENT_ID,
}: {
  id?: string;
}) {
  return (
    <svg
      className="langy-root"
      width="0"
      height="0"
      aria-hidden
      style={{ position: "absolute", pointerEvents: "none" }}
    >
      <defs>
        {/* Orange → purple, along the box's own isometric axis. */}
        <linearGradient id={id} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--chakra-colors-langy-ai-orange)" />
          <stop
            offset="100%"
            stopColor="var(--chakra-colors-langy-ai-purple)"
          />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * The LangWatch box, filled with the brand gradient. `size` is the mark's
 * HEIGHT in px; width follows the logo's natural 38:52 ratio.
 */
export function LangyMark({
  size = 20,
  gradientId = LANGY_MARK_GRADIENT_ID,
}: {
  size?: number;
  gradientId?: string;
}) {
  const width = (size * MARK_VIEWBOX_WIDTH) / MARK_VIEWBOX_HEIGHT;
  return (
    <svg
      className="langy-mark"
      width={width}
      height={size}
      viewBox={`0 0 ${MARK_VIEWBOX_WIDTH} ${MARK_VIEWBOX_HEIGHT}`}
      fill="none"
      aria-hidden
      // The interior wireframe is sub-pixel at avatar sizes; ask for geometry
      // over speed so the lines stay lines.
      shapeRendering="geometricPrecision"
    >
      <path fill={`url(#${gradientId})`} d={LOGO_LINES_PATH} />
    </svg>
  );
}

/**
 * The AI gradient as a surface wash — an oversized gradient drifting slowly
 * behind an affordance so a solid fill breathes. Replaces the shared WebGL
 * `MeshGradientLayer` (whose palette carries the retired hot pink, and which
 * pays for a shader to do what a CSS gradient does): position it inside a
 * `position: relative` parent and stack the foreground at `zIndex: 1`.
 *
 * `active` tightens the loop for the "working" state. Both loops are slow on
 * purpose — this is a background that breathes, not one that pulses. Static
 * under `prefers-reduced-motion: reduce` (belt-and-braces: the hook drops the
 * animation prop, and `langyTheme.css` also kills it via `.langy-mesh`).
 */
export function LangyMeshLayer({
  active = false,
  borderRadius,
  zIndex,
}: {
  active?: boolean;
  borderRadius?: string;
  zIndex?: number;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <Box
      className="langy-mesh"
      position="absolute"
      inset={0}
      zIndex={zIndex}
      pointerEvents="none"
      overflow="hidden"
      borderRadius={borderRadius}
      backgroundImage="var(--langy-ai-gradient)"
      backgroundSize="220% 220%"
      backgroundPosition="0% 50%"
      animation={
        reduceMotion
          ? undefined
          : `langy-mesh-drift ${active ? "14s" : "26s"} ease-in-out infinite`
      }
    />
  );
}
