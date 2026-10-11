import { Box } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";
import "../../../../packages/design-system/src/components/brand/ambient-ground.css";

/**
 * The design system's ambient ground in static, quiet form: its CSS floor and protection, no shader.
 * To move into AmbientGround as `motion="static"` and `intensity="quiet"`.
 */
export function StaticGround({ children }: { children: ReactNode }) {
  return (
    <Box position="relative" isolation="isolate" overflow="clip">
      <div className="lw-ambient-ground docs-ground" aria-hidden="true">
        <div className="lw-ambient-ground-static" />
        <div className="lw-ambient-ground-protect docs-ground-protect" />
        <div className="docs-ground-cover" />
      </div>
      <Box position="relative" zIndex={1}>
        {children}
      </Box>
    </Box>
  );
}
