import { Box } from "@chakra-ui/react";
import { MeshGradient } from "@paper-design/shaders-react";
import type { ReactNode } from "react";
import { useColorModeValue } from "~/components/ui/color-mode";
import { useReducedMotion } from "~/hooks/useReducedMotion";

/**
 * The lit ground the governance hero stands on — the same moving mesh the
 * project home lights its ask field with.
 *
 * The two homes ask the reader for the same thing in the same words, and until
 * now only one of them was lit: governance opened on flat page white, which
 * read as an unfinished copy of a screen the reader had already seen working.
 * This is that ground and nothing else. The project home's version lives
 * inside `HomePageBanners`, wrapped around the announcement carousel, per
 * project snoozes and the Langy store — none of which exist on an
 * org-scoped page — so what is shared here is the treatment, deliberately
 * rebuilt small, rather than a component dragged across a scope it does not
 * fit. Palette, opacity, mask and blur are copied value for value from the
 * lantern so the two grounds are the same light.
 *
 * It bleeds past its own box on purpose. The hero is not an object on the
 * page, it is where the page is lit from.
 *
 * Spec: specs/ai-governance/dashboard/governance-overview-hero.feature
 */

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
 * How far the light spills past the content it stands behind.
 *
 * Wider than the lantern's own -14%, and for the reason the two look alike
 * rather than in spite of it. The project home lights a hero inside a 7xl
 * container; this one lights a 900px column, so the same percentage would
 * light a box little more than half as wide — the mesh would be squeezed into
 * a patch behind the field and read as a stain rather than as a room being
 * lit. These percentages put the ground at roughly the same measure in pixels
 * as the one on the project home.
 */
const BLEED_INLINE = { base: "-12%", md: "-30%" };
const BLEED_BLOCK = { base: "-30%", md: "-45%" };

export function GovernanceHeroGround({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const isDark = useColorModeValue(false, true);
  const colors = isDark ? GROUND_COLORS_DARK : GROUND_COLORS;

  return (
    <Box position="relative" width="full">
      {/* The colour. Bright enough to actually be light — held at a whisper
          it reads as a tint rather than as a moving mesh, which is the same
          as not having it. Blurred on light only: on a pale ground the mesh's
          bands keep their edges and read as banding, while the same blur on
          dark only muddies a field that already reads as depth. */}
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

      {/* Light mode only: a white bloom over the ground's middle. On a pale
          page the colours behind the greeting and the field read as smudge
          rather than as light, so this keeps that zone clean. An ellipse
          rather than a band, so the colour still leaks past its left and
          right edges and the ground reads as light the content stands in
          front of rather than a curtain dropped over it. Dark keeps the full
          field. Covers the same bleed box so the two track exactly. */}
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
