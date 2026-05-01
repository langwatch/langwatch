import { Box, Flex } from "@chakra-ui/react";
import React from "react";
import { EmptyStateOverlay } from "../../onboarding/components/EmptyStateOverlay";
import { SampleDataBanner } from "../../onboarding/components/SampleDataBanner";
import { OnboardingAurora } from "../../onboarding/effects/OnboardingAurora";
import { useOnboardingStore } from "../../onboarding/store/onboardingStore";
import { Toolbar } from "../Toolbar/Toolbar";
import { TraceTable } from "../TraceTable/TraceTable";

export const EmptyResultsPane: React.FC = React.memo(() => {
  // The trace list query short-circuits to `SAMPLE_PREVIEW_TRACES`
  // (purely client-side) whenever this pane is rendered, so the table
  // behind is always populated with interactive rows. The dim lifts
  // the moment the user commits to an exit action (`setupDisengaged`)
  // — sample data is already on screen, no waiting for ingestion.
  const setupDisengaged = useOnboardingStore((s) => s.setupDisengaged);
  const onboardingStage = useOnboardingStore((s) => s.stage);
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
      {/* Toolbar stays fully interactive during the tour — it now
          carries the "On safari" exit affordance, which is the only
          way out of the journey. Dimming/inert-ing it would make
          the tour feel like a trap. */}
      <Toolbar />
      {/* Sample-data banner — sits between toolbar and table so users
          can read it before they touch a facet. Always-on while preview
          is active; exit is the toolbar's "On safari" button, which
          flips the dismissal flag and drops the user into the real
          (empty) table. */}
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
              // straight to drawerOverview, the finale chapter); the
              // highlighted rich row is just the visually obvious
              // target, not the only one. setupDisengaged is the
              // post-onboarding state where preview data is still
              // rendering. The row glow itself is a global stylesheet
              // rule injected by `OnboardingHost`'s `<RichRowGlow>`
              // effect — see `onboarding/effects/RichRowGlow.tsx`.
              {}
            : ({
                pointerEvents: "none",
                "aria-disabled": true,
                inert: "",
              } as Record<string, unknown>))}
        >
          <TraceTable />
        </Box>
        {/* Aurora ribbon — self-gates on stage, lazy-mounts only
            during aurora stages. Owned by the onboarding module so
            this pane doesn't have to know about `shouldShowAurora`
            or the mask geometry; see
            `onboarding/effects/OnboardingAurora.tsx`. */}
        <OnboardingAurora />
        {/* Outer wrapper is pointer-events:none so clicks fall
            through to the table behind it (notably the highlighted
            row during `postArrival`, which is otherwise eclipsed by
            this scroll-container's hit area). The hero composition
            inside `EmptyStateOverlay` sets pointer-events:auto on
            its inner Box, so headings, CTAs, and density cards stay
            clickable. We also drop `overflow:auto` here for the same
            reason — overflow:auto creates a hit-testable scroll
            container. The hero composition Flex inside has its own
            overflow:auto for the rare tall-hero case. */}
        <Box
          position="absolute"
          inset={0}
          zIndex={1}
          pointerEvents="none"
        >
          <EmptyStateOverlay />
        </Box>
      </Box>
    </Flex>
  );
});
EmptyResultsPane.displayName = "EmptyResultsPane";
