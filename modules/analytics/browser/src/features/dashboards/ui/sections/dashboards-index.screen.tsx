/** `/[project]/dashboards` has no page of its own: it forwards to the member's landing board. */

import { Box } from "@chakra-ui/react";
import { UiPageLoading, UiPageNotFound } from "@langwatch/ui-kernel/page-fallbacks";

import { HandledErrorAlert } from "../../../../ui/elements/handled-error-alert.tsx";
import { useLandingBoard } from "../../behavior/use-landing-board.ts";
import { DashboardsGate } from "./dashboards-gate.tsx";

function LandingRedirect() {
  const { loadError, createError } = useLandingBoard();
  // A refused list reads as the same not-found page the board screen shows (AC21).
  if (loadError) return <UiPageNotFound />;
  if (!createError) return <UiPageLoading />;
  return (
    <Box maxWidth="640px" marginX="auto" padding={8}>
      <HandledErrorAlert
        error={createError}
        fallbackTitle="Your first dashboard could not be made"
      />
    </Box>
  );
}

export default function DashboardsIndexScreen() {
  return (
    <DashboardsGate>
      <LandingRedirect />
    </DashboardsGate>
  );
}
