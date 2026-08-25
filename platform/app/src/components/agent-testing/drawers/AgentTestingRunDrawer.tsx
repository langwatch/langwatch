/**
 * The Agent Testing run detail drawer: the same run drawer the classic pages
 * use, wider, with the judge results beside the conversation when the screen
 * gives enough room and stacked under it when it does not.
 *
 * It can open before the run has an id: a one-off run opens the drawer the
 * moment it is queued, the batch is watched until the run appears, and the
 * conversation then streams in live.
 *
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 * @see specs/features/agent-testing/live-one-off-run.feature
 * @see specs/scenarios/scenario-version-on-runs.feature
 */

import { RunScenarioModal } from "~/components/scenarios/RunScenarioModal";
import { Drawer } from "~/components/ui/drawer";
import { useDrawer } from "~/hooks/useDrawer";
import { RunDrawerContent } from "./RunDrawerContent";
import { RunDrawerHeaderBand } from "./RunDrawerHeaderBand";
import { RunDrawerQueuedBody } from "./RunDrawerQueuedBody";
import {
  type RunDrawerState,
  useRunDrawerState,
  useRunDrawerStop,
} from "./useRunDrawerState";

/** The drawer once the run has state, and the queued read until it does. */
function RunDrawerBody({
  state,
  stop,
}: {
  state: RunDrawerState;
  stop: ReturnType<typeof useRunDrawerStop>;
}) {
  const { detail, scenarioState } = state;

  if (!scenarioState) {
    return (
      <RunDrawerQueuedBody
        error={detail.runStateError}
        scenarioId={state.knownScenarioId}
      />
    );
  }

  return (
    <Drawer.Body
      paddingY={0}
      paddingX={0}
      display="flex"
      flexDirection="column"
      width="full"
      height="full"
      overflow="hidden"
      bg={{ base: "bg.surface", _dark: "bg.panel" }}
    >
      <RunDrawerHeaderBand
        detail={detail}
        scenarioVersion={state.scenarioVersion}
        stop={stop}
      />
      <RunDrawerContent detail={detail} isSideBySide={state.isSideBySide} />
    </Drawer.Body>
  );
}

export function AgentTestingRunDrawer({ open }: { open?: boolean }) {
  const { closeDrawer } = useDrawer();
  const state = useRunDrawerState({ open: !!open });
  const { detail } = state;
  const stop = useRunDrawerStop({
    scenarioRunId: state.scenarioRunId,
    scenarioState: state.scenarioState,
  });

  return (
    <>
      <Drawer.Root
        open={!!open}
        onOpenChange={() => closeDrawer()}
        placement="end"
        size="lg"
      >
        <Drawer.Content
          bg="transparent"
          paddingX={0}
          maxWidth="1100px"
          overflow="hidden"
          borderRadius="lg"
          data-testid="agent-testing-run-drawer"
        >
          <RunDrawerBody state={state} stop={stop} />
        </Drawer.Content>
      </Drawer.Root>

      <RunScenarioModal
        open={detail.runModalOpen}
        onClose={() => detail.setRunModalOpen(false)}
        onRun={detail.handleRunAgain}
        initialTarget={detail.persistedTarget}
        isLoading={detail.isRunning}
      />
    </>
  );
}
