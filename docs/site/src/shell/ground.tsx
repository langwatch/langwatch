import { Box } from "@langwatch/design-system/primitives";
import { GROUND_HEIGHT } from "./layout.ts";
import "../../../../packages/design-system/src/components/brand/ambient-ground.css";

/**
 * The design system's ambient ground at the top of the page: its static CSS floor, no shader,
 * fading into the surface. To move into AmbientGround as `motion="static"` with a page-top height.
 */
export function PageGround() {
  return (
    <Box position="absolute" top="0" left="0" right="0" height={GROUND_HEIGHT} pointerEvents="none" aria-hidden="true" zIndex="0">
      <div className="lw-ambient-ground docs-ground">
        <div className="lw-ambient-ground-static" />
        <div className="lw-ambient-ground-static docs-ground-boost" />
        <div className="docs-ground-cover" />
      </div>
    </Box>
  );
}
