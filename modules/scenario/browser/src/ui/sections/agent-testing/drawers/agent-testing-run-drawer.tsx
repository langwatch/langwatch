/**
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 * @see specs/features/agent-testing/live-single-scenario-run.feature
 * @see specs/scenarios/scenario-version-on-runs.feature
 */

import { useDrawer } from "@langwatch/browser-host/drawer";
import { Drawer } from "@langwatch/design-system/drawer";
import { Box, VStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import { HandledErrorAlert } from "../../../../behavior/errors.tsx";
import { RunDrawerContent } from "./run-drawer-content.tsx";
import { RunDrawerHeaderBand } from "./run-drawer-header-band.tsx";
import { RunDrawerLoadingBody } from "./run-drawer-loading-body.tsx";
import {
  type RunDrawerState,
  useRunDrawerState,
  useRunDrawerStop,
} from "./use-run-drawer-state.ts";

/** The run's own ground, under the transcript and the results. */
function RunSurface({ children }: { children: ReactNode }) {
  return (
    <Box
      display="flex"
      flexDirection="column"
      flex={1}
      minHeight={0}
      width="full"
      overflow="hidden"
      bg="bg.card"
    >
      {children}
    </Box>
  );
}

/**
 * What the run drawer reads when the run behind the address cannot be read.
 * @see specs/features/agent-testing/live-single-scenario-run.feature
 */
function RunDrawerErrorBody({ error }: { error: unknown }) {
  return (
    <RunSurface>
      <VStack gap={3} align="start" w="100%" pt={4} paddingX={4}>
        <Box width="100%">
          <HandledErrorAlert error={error} fallbackTitle="Failed to load run" />
        </Box>
      </VStack>
    </RunSurface>
  );
}

/**
 * The drawer body. A queued run draws the same as a running one, so the
 * layout does not appear piece by piece while the reader waits: only a read
 * that is still on its way, or one that failed, draws something else.
 */
function RunDrawerBody({ state }: { state: RunDrawerState }) {
  // While the read is on its way the drawer must not say "Queued": that is a
  // status of the run, not a report on our own request.
  if (state.isReadingRun) return <RunDrawerLoadingBody />;
  if (state.readFailed) return <RunDrawerErrorBody error={state.detail.runStateError} />;
  return (
    <RunSurface>
      <RunDrawerContent detail={state.detail} isSideBySide={state.isSideBySide} />
    </RunSurface>
  );
}

/** The header band, on the run's ground; the frame's 3rem for the X is painted through. */
function RunDrawerHeader({
  state,
  stop,
}: {
  state: RunDrawerState;
  stop: ReturnType<typeof useRunDrawerStop>;
}) {
  if (state.isReadingRun || state.readFailed) return null;
  return (
    <Box bg="bg.card" borderTopRadius="lg" width="calc(100% + 3rem)">
      <RunDrawerHeaderBand
        detail={state.detail}
        scenarioVersion={state.scenarioVersion}
        stop={stop}
      />
    </Box>
  );
}

/**
 * The drawer starts no run of its own: Run again opens the run dialog, which
 * is the one place a run plan name is resolved.
 */
export function AgentTestingRunDrawer({ open }: { open?: boolean }) {
  const { closeDrawer } = useDrawer();
  const state = useRunDrawerState({ open: !!open });
  const stop = useRunDrawerStop({
    scenarioRunId: state.scenarioRunId,
    scenarioState: state.scenarioState,
  });

  return (
    <Drawer
      open={!!open}
      // Only a close is a close: asking to open must not close the drawer, and
      // the run that opened it would land on a bare page.
      onClose={closeDrawer}
      size="wide"
      title="Run details"
      chrome="content"
      headerContent={<RunDrawerHeader state={state} stop={stop} />}
      data-testid="agent-testing-run-drawer"
    >
      <RunDrawerBody state={state} />
    </Drawer>
  );
}
