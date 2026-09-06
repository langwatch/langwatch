import { Box } from "@chakra-ui/react";
import { useReducedMotion } from "~/hooks/useReducedMotion";

/**
 * Langy's mark: LangWatch's own logo, repainted in the brand gradient.
 *
 * It used to be a generic 4-point sparkle — the same "AI" glyph every product
 * ships. Langy is LangWatch, so it wears LangWatch's face: the isometric box
 * from `~/components/icons/LogoIcon`, whose path data is REUSED here verbatim
 * (copied, not redrawn — the shared component paints a flat two-tone mark and
 * other surfaces depend on it, so it is left alone).
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

// Verbatim from `~/components/icons/LogoIcon` — the silhouette + wireframe
// compound path. Duplicated rather than imported because that component hard-
// codes its own fills, and it is shared with the app chrome.
const MARK_PATH =
  "M0 12.383v28.652c0 .357.19.688.5.866l16.595 9.58a.993.993 0 001 0l19.184-11.072a1 1 0 00.5-.866V10.887a.998.998 0 00-.5-.866l-6.111-3.526a.999.999 0 00-.999 0l-2.874 1.659V4.837a.998.998 0 00-.5-.866L20.684.442a1.003 1.003 0 00-1 0l-5.903 3.409a1 1 0 00-.5.866v7.44l-.36.208v-.493a1 1 0 00-.5-.866L7.405 8.107a1.005 1.005 0 00-1 0l-5.904 3.41a.998.998 0 00-.501.866zm1.5.865l4.019 2.318v7.728c0 .01.005.019.006.029a.363.363 0 00.009.065.46.46 0 00.043.128c.005.009.004.019.01.028.004.007.013.01.017.017a.464.464 0 00.12.125c.017.012.027.03.046.041l5.466 3.159c.007.004.016.002.024.006.068.035.142.06.224.06a.49.49 0 00.225-.059c.019-.01.034-.023.052-.035a.503.503 0 00.129-.127c.008-.012.021-.016.029-.029.005-.009.005-.02.01-.028.015-.03.022-.061.031-.094.009-.033.018-.065.02-.099 0-.01.006-.019.006-.029v-7.15l5.11 2.949v27.498L1.5 40.747V13.248zm34.278-2.361l-4.899 2.831-5.111-2.952.776-.449 4.124-2.38 5.11 2.95zM25.293 4.836l-4.902 2.829-5.11-2.949 4.902-2.832 5.11 2.952zM10.92 11.872l-4.901 2.829-4.018-2.318 4.903-2.832 4.016 2.321zm10.036 4.638l3.312-1.909v4.187c0 .021.01.039.012.06a.384.384 0 00.062.186c.016.027.031.054.053.078.022.026.049.047.076.068.018.013.028.03.047.041l5.36 3.093-5.88 3.394v-7.151c0-.01-.005-.019-.006-.029a.48.48 0 00-.051-.192c-.005-.009-.004-.02-.01-.028-.006-.009-.014-.014-.02-.022a.512.512 0 00-.142-.142c-.009-.006-.013-.015-.022-.02l-2.791-1.614zm4.312-4.877l5.111 2.952v6.863l-5.111-2.949v-6.866zm-12.782 6.804l4.903-2.833 5.109 2.952-4.903 2.829-5.109-2.948zm-1.501 7.15l-3.966-2.292 3.966-2.29v4.582zm1.435-11.202l1.86-1.074 2.542 1.466-4.402 2.543v-2.935zm2.36-8.803l5.111 2.949v6.863l-5.111-2.949V5.582z";

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
      <path fill={`url(#${gradientId})`} d={MARK_PATH} />
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
