import { Box, Flex } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import React from "react";
import { shouldShowAurora } from "../../onboarding/chapters/onboardingJourneyConfig";
import { EmptyStateOverlay } from "../../onboarding/components/EmptyStateOverlay";
import { SampleDataBanner } from "../../onboarding/components/SampleDataBanner";
import { RICH_ARRIVAL_TRACE_ID } from "../../onboarding/data/samplePreviewTraces";
import { useOnboardingStore } from "../../onboarding/store/onboardingStore";
import { Toolbar } from "../Toolbar/Toolbar";
import { TraceTable } from "../TraceTable/TraceTable";
import { AuroraSvg } from "./AuroraSvg";

const DIMMED_PROPS = {
  opacity: 0.45,
  pointerEvents: "none" as const,
  "aria-disabled": true,
  // `inert` keeps focus, hover, and pointer interactions out of the chrome
  // while the empty-state body is what the user should be touching.
  // React types lag the DOM property, so we widen via a record cast at the
  // call sites that compose this object.
  inert: "",
};

export const EmptyResultsPane: React.FC = React.memo(() => {
  // The trace list query short-circuits to `SAMPLE_PREVIEW_TRACES`
  // (purely client-side) whenever this pane is rendered, so the table
  // behind is always populated with interactive rows. The dim lifts
  // the moment the user commits to an exit action (`setupDisengaged`)
  // — sample data is already on screen, no waiting for ingestion.
  const setupDisengaged = useOnboardingStore((s) => s.setupDisengaged);
  const onboardingStage = useOnboardingStore((s) => s.stage);
  const showAuroraStrip = shouldShowAurora(onboardingStage);
  const isPostArrival = onboardingStage === "postArrival";

  return (
    <Flex
      as="main"
      role="main"
      aria-label="Set up tracing"
      direction="column"
      flex={1}
      minWidth={0}
      height="full"
      overflow="hidden"
    >
      <Box
        width="full"
        {...(setupDisengaged
          ? {}
          : (DIMMED_PROPS as Record<string, unknown>))}
      >
        <Toolbar />
      </Box>
      {/* Sample-data banner — sits between toolbar and table so users
          can read it before they touch a facet. Always-on while preview
          is active; the only way out is its "Done exploring" button,
          which flips the dismissal flag and drops the user into the
          real (empty) table. */}
      <SampleDataBanner />
      <Box flex={1} minHeight={0} position="relative" overflow="hidden">
        <Box
          position="absolute"
          inset={0}
          overflow="auto"
          bg="bg.muted"
          // Pre-disengaged: full opacity. Pointer events are suppressed
          // so the table behind the empty-state hero isn't accidentally
          // clickable through the overlay. The "rows-above-and-below"
          // band effect is *not* a mask on the table any more — it's a
          // hero-attached radial halo (see `EmptyState.tsx`) that auto-
          // aligns with the flex-centred hero. That keeps the layout
          // robust across viewport heights without fragile percentage
          // bands or media-query tuning.
          {...(setupDisengaged || isPostArrival
            ? // Fully clickable during postArrival — the table takes
              // the whole canvas and the user gets to explore. Any
              // sample row opens the drawer (and advances the journey
              // to tourGate via the same path); the highlighted rich
              // row is just the visually obvious target, not the only
              // one. setupDisengaged is the post-onboarding state
              // where preview data is still rendering.
              {}
            : ({
                pointerEvents: "none",
                "aria-disabled": true,
                inert: "",
              } as Record<string, unknown>))}
          // During `postArrival` the rich arrival row gets the same
          // visual language as the drawer-tour glow: a soft blue
          // halo that pulses around the *whole row*, not per-cell.
          // Implemented with `filter: drop-shadow(...)` on the
          // tbody — drop-shadow paints from the rendered cell area
          // outward, so it traces the row's outer edge as one
          // continuous shape even though `border-collapse: collapse`
          // means tbody/tr can't carry box-shadow themselves.
          // Per-cell inset box-shadow + a faint background-tint
          // give the inner ring; the row itself is `z-index: 10` so
          // the halo doesn't get clipped by neighbouring rows.
          css={
            isPostArrival
              ? {
                  // Light theme: heavier alpha needed for blue to
                  // read against a white surface without disappearing.
                  "@keyframes tracesV2RichRowGlow": {
                    "0%, 100%": {
                      filter:
                        "drop-shadow(0 0 6px rgba(59, 130, 246, 0.45)) drop-shadow(0 0 16px rgba(99, 102, 241, 0.24))",
                    },
                    "50%": {
                      filter:
                        "drop-shadow(0 0 12px rgba(59, 130, 246, 0.7)) drop-shadow(0 0 26px rgba(99, 102, 241, 0.36))",
                    },
                  },
                  // Dark theme: sky-blue palette (blue.300-ish) so the
                  // glow stays visible without going neon. Lower
                  // base alpha, similar peak — same shape, tuned
                  // for the darker canvas.
                  "@keyframes tracesV2RichRowGlowDark": {
                    "0%, 100%": {
                      filter:
                        "drop-shadow(0 0 8px rgba(125, 211, 252, 0.32)) drop-shadow(0 0 20px rgba(165, 180, 252, 0.2))",
                    },
                    "50%": {
                      filter:
                        "drop-shadow(0 0 14px rgba(125, 211, 252, 0.55)) drop-shadow(0 0 30px rgba(165, 180, 252, 0.34))",
                    },
                  },
                  [`& tbody[data-trace-id="${RICH_ARRIVAL_TRACE_ID}"]`]: {
                    position: "relative",
                    zIndex: 10,
                    cursor: "pointer",
                    animation:
                      "tracesV2RichRowGlow 2.2s ease-in-out infinite",
                    transition: "filter 220ms ease",
                    _dark: {
                      animation:
                        "tracesV2RichRowGlowDark 2.2s ease-in-out infinite",
                    },
                  },
                  // Inner blue ring — inset shadow on every cell,
                  // gives the row a clear outline that joins up
                  // along shared edges (collapsed borders share
                  // pixels so adjacent insets line up). Background
                  // tint is the same uniform alpha across the row.
                  [`& tbody[data-trace-id="${RICH_ARRIVAL_TRACE_ID}"] td`]:
                    {
                      backgroundColor: "rgba(59, 130, 246, 0.08)",
                      boxShadow: "inset 0 0 0 1px rgba(59, 130, 246, 0.45)",
                      transition:
                        "background-color 200ms ease, box-shadow 200ms ease",
                      _dark: {
                        backgroundColor: "rgba(125, 211, 252, 0.1)",
                        boxShadow:
                          "inset 0 0 0 1px rgba(125, 211, 252, 0.32)",
                      },
                    },
                  [`& tbody[data-trace-id="${RICH_ARRIVAL_TRACE_ID}"]:hover td`]:
                    {
                      backgroundColor: "rgba(59, 130, 246, 0.18)",
                      boxShadow: "inset 0 0 0 1px rgba(59, 130, 246, 0.7)",
                      _dark: {
                        backgroundColor: "rgba(125, 211, 252, 0.2)",
                        boxShadow:
                          "inset 0 0 0 1px rgba(125, 211, 252, 0.55)",
                      },
                    },
                }
              : undefined
          }
        >
          <TraceTable />
        </Box>
        {/* Aurora strip — exact same pattern as `RefreshProgressBar`
            so the visual word (a refresh / arrival / new-span swell)
            stays consistent everywhere on the platform. The only
            tweak is an extra horizontal mask so the ribbon fades
            into the page edges. Normally `FilterSidebar` covers the
            leftmost slice and gives a natural visual gutter; during
            onboarding the sidebar is hidden, so without the
            horizontal fade the aurora would butt right up against
            the viewport edge and read as a banner. */}
        <AnimatePresence>
          {showAuroraStrip && (
            <motion.div
              key="onboarding-aurora"
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              style={{
                position: "absolute",
                top: "-90px",
                left: 0,
                right: 0,
                height: 200,
                pointerEvents: "none",
                zIndex: 2,
                overflow: "hidden",
                maskImage:
                  "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,0.7) 65%, transparent 100%), linear-gradient(to right, transparent 0%, rgba(0,0,0,1) 14%, rgba(0,0,0,1) 86%, transparent 100%)",
                WebkitMaskImage:
                  "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,0.7) 65%, transparent 100%), linear-gradient(to right, transparent 0%, rgba(0,0,0,1) 14%, rgba(0,0,0,1) 86%, transparent 100%)",
                maskComposite: "intersect",
                WebkitMaskComposite: "source-in",
              }}
            >
              <AuroraSvg idSuffix="onboardingArrival" />
            </motion.div>
          )}
        </AnimatePresence>
        <Box position="absolute" inset={0} overflow="auto" zIndex={1}>
          <EmptyStateOverlay />
        </Box>
      </Box>
    </Flex>
  );
});
EmptyResultsPane.displayName = "EmptyResultsPane";
