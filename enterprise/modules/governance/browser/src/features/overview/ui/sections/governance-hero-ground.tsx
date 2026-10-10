import { useColorRawValue } from "@langwatch/design-system/color-mode";
/**
 * The lit ground the governance hero stands on, bleeding past its own box
 * on purpose — the hero is where the page is lit from, not an object on it.
 * Spec: specs/ai-governance/dashboard/governance-overview-hero.feature
 */
import { Box, ClientOnly } from "@langwatch/design-system/primitives";
import { useReducedMotion } from "@langwatch/design-system/use-reduced-motion";
import { MeshGradient } from "@paper-design/shaders-react";
import type { ReactNode } from "react";

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
 * How far the light spills past its content — wider than the lantern's own
 * -14%, since this column (900px) is narrower than the project home's 7xl,
 * so the same percentage would squeeze the mesh into a stain, not a room.
 */
const BLEED_INLINE = { base: "-12%", md: "-30%" };
const BLEED_BLOCK = { base: "-30%", md: "-45%" };

export function GovernanceHeroGround({ children }: { children: ReactNode }) {
  return (
    <Box position="relative" width="full">
      {/* Both bleed layers sit at zIndex -1, lighting the page from behind so the header row
          they reach is never washed out (#8318); the screen's zIndex 1 column holds them. */}
      {/* The colour, bright enough to read as light. Blurred on light mode
          only — the same blur on dark just muddies a field that already
          reads as depth. */}
      <Box
        aria-hidden
        position="absolute"
        zIndex={-1}
        insetInline={BLEED_INLINE}
        insetBlock={BLEED_BLOCK}
        pointerEvents="none"
        opacity={{ base: 0.3, _dark: 0.45 }}
        filter={{ base: "blur(15px)", _dark: "blur(5px)" }}
        css={{
          maskImage: "radial-gradient(58% 62% at 50% 46%, #000 12%, transparent 72%)",
          WebkitMaskImage: "radial-gradient(58% 62% at 50% 46%, #000 12%, transparent 72%)",
        }}
      >
        <ClientOnly>
          <HeroMesh />
        </ClientOnly>
      </Box>

      {/* Light mode only: a white bloom keeps the middle clean so the
          greeting and field don't read as smudge. Dark keeps the full field. */}
      <Box
        aria-hidden
        position="absolute"
        zIndex={-1}
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

function HeroMesh() {
  const reduceMotion = useReducedMotion();
  const orange = useColorRawValue("orange.solid");
  const warmth = useColorRawValue("orange.emphasized");
  const purple = useColorRawValue("purple.solid");
  return (
    <MeshGradient
      colors={[orange, warmth, purple]}
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
  );
}
