import { Box, Flex } from "@chakra-ui/react";
import React from "react";
import { EmptyStateOverlay } from "../../onboarding/components/EmptyStateOverlay";
import { SampleDataBanner } from "../../onboarding/components/SampleDataBanner";
import { OnboardingAurora } from "../../onboarding/effects/OnboardingAurora";
import { useOnboardingStore } from "../../onboarding/store/onboardingStore";
import { Toolbar } from "../Toolbar/Toolbar";
import { TraceTable } from "../TraceTable/TraceTable";

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
        {...(setupDisengaged ? {} : (DIMMED_PROPS as Record<string, unknown>))}
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
              // where preview data is still rendering. The row glow
              // itself is a global stylesheet rule injected by
              // `OnboardingHost`'s `<RichRowGlow>` effect — see
              // `onboarding/effects/RichRowGlow.tsx`.
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
        <Box position="absolute" inset={0} overflow="auto" zIndex={1}>
          <EmptyStateOverlay />
        </Box>
      </Box>
    </Flex>
  );
});
EmptyResultsPane.displayName = "EmptyResultsPane";
