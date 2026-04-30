import { Box, Flex } from "@chakra-ui/react";
import { OnboardingMeshBackground } from "~/features/onboarding/components/OnboardingMeshBackground";
import { useOnboardingStageStore } from "../../stores/onboardingStageStore";
import { findStageDef, type HeroLayout } from "./onboardingJourneyConfig";
import { TracesEmptyOnboarding } from "./TracesEmptyOnboarding";
import { useEdgeGripAnchor } from "./useEdgeGripAnchor";

/**
 * Onboarding overlay rendered above the populated trace preview when
 * the project hasn't received real traces yet.
 *
 * Layering, bottom → top:
 *   1. `OnboardingMeshBackground` — soft warm radial gradients.
 *   2. Hero band — full-width horizontal stripe of `bg.muted` with
 *      a vertical fade, sized to ~58vh. Auto-centres with the hero.
 *   3. Hero composition (positioned per `stageDef.heroLayout`).
 *
 * Density toggles visibly reflow the rows above and below the band
 * in real time — that's the demo.
 */
export const EmptyState = () => {
  const stage = useOnboardingStageStore((s) => s.stage);
  const stageDef = findStageDef(stage);
  const heroLayout: HeroLayout = stageDef.heroLayout ?? "centre";
  // While the drawer is open (left layout) we anchor the hero
  // halfway between the dashboard's left edge and the drawer's
  // left edge — `useEdgeGripAnchor` returns the drawer's left
  // X-coord live, so the hero stays centred in the *visible*
  // canvas regardless of drawer width or resize.
  const drawerLeftX = useEdgeGripAnchor(heroLayout === "left");
  const heroFlexProps = layoutFlexProps(heroLayout, drawerLeftX);

  return (
    <>
      {/* Global CSS hook for the drawer-overview tour stage. The
          drawer is portaled to <body>, so we can't scope a glow
          rule to it via a normal Chakra css prop on the parent.
          `TracesEmptyOnboarding` toggles `body.data-traces-tour-stage`
          live; this style only matches during `drawerOverview`. */}
      <style>{`
        /* Light-mode glows. We crank the alpha higher than the
           dark variant because indigo-blue at .25 alpha disappears
           against a white surface; .5+ is needed for the ring to
           read as a ring. The sidebar tour glow shares the same
           palette as the drawer glow on purpose — same tour, same
           visual language — but tunes the spread to fit the
           narrower aside. We use html.dark for the dark-mode
           override (Chakra v3's class-based color mode), not a
           prefers-color-scheme media query, so the glow follows
           the user's *theme* choice rather than their OS pref. */
        @keyframes tracesTourDrawerGlow {
          0%, 100% {
            box-shadow:
              inset 0 0 0 1px rgba(59, 130, 246, 0.5),
              0 0 28px rgba(59, 130, 246, 0.32),
              0 0 64px rgba(99, 102, 241, 0.22);
          }
          50% {
            box-shadow:
              inset 0 0 0 2px rgba(59, 130, 246, 0.7),
              0 0 44px rgba(59, 130, 246, 0.45),
              0 0 96px rgba(99, 102, 241, 0.32);
          }
        }
        @keyframes tracesTourSidebarGlow {
          0%, 100% {
            box-shadow:
              inset 0 0 0 1px rgba(59, 130, 246, 0.5),
              0 0 22px rgba(59, 130, 246, 0.3);
          }
          50% {
            box-shadow:
              inset 0 0 0 2px rgba(59, 130, 246, 0.7),
              0 0 44px rgba(59, 130, 246, 0.45);
          }
        }
        body[data-traces-tour-stage="drawerOverview"] [data-tour-target="drawer"] {
          animation: tracesTourDrawerGlow 2.6s ease-in-out infinite;
        }
        body[data-traces-tour-stage="facetsReveal"] [data-tour-target="sidebar"] {
          animation: tracesTourSidebarGlow 2.4s ease-in-out infinite;
          position: relative;
          z-index: 1;
        }
        html.dark body[data-traces-tour-stage="drawerOverview"] [data-tour-target="drawer"] {
          animation: tracesTourDrawerGlowDark 2.6s ease-in-out infinite;
        }
        html.dark body[data-traces-tour-stage="facetsReveal"] [data-tour-target="sidebar"] {
          animation: tracesTourSidebarGlowDark 2.4s ease-in-out infinite;
        }
        @keyframes tracesTourDrawerGlowDark {
          0%, 100% {
            box-shadow:
              inset 0 0 0 1px rgba(125, 211, 252, 0.32),
              0 0 28px rgba(125, 211, 252, 0.22),
              0 0 64px rgba(165, 180, 252, 0.16);
          }
          50% {
            box-shadow:
              inset 0 0 0 2px rgba(125, 211, 252, 0.55),
              0 0 44px rgba(125, 211, 252, 0.4),
              0 0 96px rgba(165, 180, 252, 0.3);
          }
        }
        @keyframes tracesTourSidebarGlowDark {
          0%, 100% {
            box-shadow:
              inset 0 0 0 1px rgba(125, 211, 252, 0.3),
              0 0 22px rgba(125, 211, 252, 0.22);
          }
          50% {
            box-shadow:
              inset 0 0 0 2px rgba(125, 211, 252, 0.55),
              0 0 44px rgba(125, 211, 252, 0.4);
          }
        }
      `}</style>
      {/* Settle: no mesh, no mask. The user sees the spans and the
          surrounding chrome as-is for ~1.4s, so the page reads as a
          real product they're looking at — not a marketing
          sequence. Mesh + hero band fade in only when the welcome
          typewriter starts. */}
      {stage !== "settle" && <OnboardingMeshBackground />}
      {/* Hero band — full-width horizontal fade. Sticks regardless
          of where the hero is anchored, because once the user is
          past the table-centric beats (drawer open, sidebar open)
          the band fades into being a soft atmospheric wash. Fades
          in over the settle → welcome transition so the page
          calmly slides into onboarding rather than slamming in. */}
      <Flex
        position="absolute"
        inset={0}
        align="center"
        justify="center"
        zIndex={1}
        pointerEvents="none"
        opacity={stage === "settle" ? 0 : 1}
        transition="opacity 0.7s ease-out"
      >
        <Box
          width="full"
          // `clamp` keeps the band big enough to mask the hero +
          // CTAs on short viewports (~650px tall, where 58vh is
          // only 377px and the buttons would land below the
          // band) while preventing it from ballooning to half a
          // metre of grey on very tall viewports (1400px+ would
          // otherwise hit 812px). The 420px floor and 680px
          // ceiling were eyeballed against the journey hero —
          // tall enough to cover heading + subhead + CTAs +
          // density cards, short enough to leave room for the
          // table rows top and bottom of the band.
          height={{
            base: "clamp(420px, 62vh, 680px)",
            md: "clamp(420px, 58vh, 680px)",
          }}
          css={{
            background:
              "linear-gradient(to bottom, transparent 0%, var(--chakra-colors-bg-muted) 22%, var(--chakra-colors-bg-muted) 78%, transparent 100%)",
          }}
        />
      </Flex>
      {/* Hero composition. The Flex container's align/justify shift
          based on `heroLayout` so the hero re-anchors as the journey
          enters the drawer-tour stages (left column) and the facets
          stage (bottom-centre). The inner Box keeps pointer events
          live just on the hero content; the rest of the overlay
          passes clicks through to the table behind. */}
      <Flex
        position="absolute"
        inset={0}
        zIndex={2}
        padding={4}
        overflow="auto"
        pointerEvents="none"
        {...heroFlexProps}
        transition="all 320ms cubic-bezier(0.16, 1, 0.3, 1)"
      >
        <Box pointerEvents="auto">
          <TracesEmptyOnboarding />
        </Box>
      </Flex>
    </>
  );
};

function layoutFlexProps(layout: HeroLayout, drawerLeftX: number | null) {
  if (layout === "left") {
    // When the drawer is mounted we know its left X-coordinate.
    // Setting `paddingRight` to `(viewport - drawerLeft)` shrinks
    // the flex container's effective width down to just the
    // visible canvas, and `justify: center` then naturally lands
    // the hero at the midpoint between the dashboard left edge
    // and the drawer. Vertical centring stays the same.
    // Fallback to a fixed left padding before the drawer mounts.
    if (drawerLeftX != null && typeof window !== "undefined") {
      const viewportRight = window.innerWidth;
      const paddingRightPx = Math.max(0, viewportRight - drawerLeftX);
      return {
        align: "center" as const,
        justify: "center" as const,
        paddingRight: `${paddingRightPx}px`,
      };
    }
    return {
      align: "center" as const,
      justify: "flex-start" as const,
      paddingLeft: { base: 4, md: 8, lg: 12 },
    };
  }
  if (layout === "bottomCentre") {
    return {
      align: "flex-end" as const,
      justify: "center" as const,
      paddingBottom: { base: 8, md: 12 },
    };
  }
  return { align: "center" as const, justify: "center" as const };
}
