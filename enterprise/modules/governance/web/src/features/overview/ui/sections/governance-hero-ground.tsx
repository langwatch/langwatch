/**
 * The lit ground the governance hero stands on — the same moving mesh the
 * project home lights its ask field with, rebuilt small rather than dragged
 * in with the carousel and Langy-store state that scope does not have here.
 * It bleeds past its own box on purpose: the hero is where the page is lit
 * from, not an object on it. Ported from `.../governance/home/GovernanceHeroGround.tsx` (main).
 * Spec: specs/ai-governance/dashboard/governance-overview-hero.feature
 */
import { Box } from "@chakra-ui/react";
import { useColorModeValue } from "@langwatch/design-system/color-mode";
import { MeshGradient } from "@paper-design/shaders-react";
import type { ReactNode } from "react";
import { useReducedMotion } from "../elements/use-reduced-motion.ts";

/** Langy's palette, resolved. The shader cannot read CSS variables. */
const GROUND_COLORS = ["#f56b1a", "#ffb380", "#6e57d2"];
const GROUND_COLORS_DARK = ["#a8480d", "#f56b1a", "#5b41c2"];

/** The lantern's own mesh, held still rather than morphed between slides. */
const MESH = {
  distortion: 0.8,
  swirl: 0.6,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  scale: 0.9,
} as const;

/**
 * How far the light spills past the content it stands behind. Wider than the
 * lantern's own -14%: this column is narrower (900px vs. the project home's
 * 7xl), so the same percentage would squeeze the mesh into a stain rather
 * than a room. These put the ground at roughly the same pixel measure.
 */
const BLEED_INLINE = { base: "-12%", md: "-30%" };
const BLEED_BLOCK = { base: "-30%", md: "-45%" };

export function GovernanceHeroGround({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const isDark = useColorModeValue(false, true);
  const colors = isDark ? GROUND_COLORS_DARK : GROUND_COLORS;

  return (
    <Box position="relative" width="full">
      {/* The colour, bright enough to read as light. Blurred on light mode
          only — the same blur on dark just muddies a field that already
          reads as depth. */}
      <Box
        aria-hidden
        position="absolute"
        insetInline={BLEED_INLINE}
        insetBlock={BLEED_BLOCK}
        pointerEvents="none"
        opacity={{ base: 0.3, _dark: 0.45 }}
        filter={{ base: "blur(15px)", _dark: "blur(5px)" }}
        css={{
          maskImage:
            "radial-gradient(58% 62% at 50% 46%, #000 12%, transparent 72%)",
          WebkitMaskImage:
            "radial-gradient(58% 62% at 50% 46%, #000 12%, transparent 72%)",
        }}
      >
        <MeshGradient
          colors={colors}
          distortion={MESH.distortion}
          swirl={MESH.swirl}
          offsetX={MESH.offsetX}
          offsetY={MESH.offsetY}
          rotation={MESH.rotation}
          grainMixer={0.12}
          grainOverlay={0.12}
          speed={reduceMotion ? 0 : 0.45}
          scale={MESH.scale}
          style={{ width: "100%", height: "100%" }}
        />
      </Box>

      {/* Light mode only: a white bloom keeps the middle clean so the
          greeting and field don't read as smudge. Dark keeps the full field. */}
      <Box
        aria-hidden
        position="absolute"
        insetInline={BLEED_INLINE}
        insetBlock={BLEED_BLOCK}
        pointerEvents="none"
        display={{ base: "block", _dark: "none" }}
        background="radial-gradient(62% 64% at 50% 28%, var(--chakra-colors-bg) 0%, var(--chakra-colors-bg) 52%, transparent 78%)"
      />

      <Box position="relative" zIndex={1}>
        {children}
      </Box>
    </Box>
  );
}
