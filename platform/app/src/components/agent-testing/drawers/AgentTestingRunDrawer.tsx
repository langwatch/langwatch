/**
 * The Agent Testing run detail drawer: the same run drawer the classic pages
 * use, wider, with the judge results beside the conversation when the screen
 * gives enough room and stacked under it when it does not.
 *
 * It can open before the run has an id: a run of one scenario opens the drawer
 * the moment it is queued, the batch is watched until the run appears, and the
 * conversation then streams in live.
 *
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 * @see specs/features/agent-testing/live-single-scenario-run.feature
 * @see specs/scenarios/scenario-version-on-runs.feature
 */

import { Drawer } from "~/components/ui/drawer";
import { useDrawer } from "~/hooks/useDrawer";
import { RunDrawerContent } from "./RunDrawerContent";
import { RunDrawerErrorBody } from "./RunDrawerErrorBody";
import { RunDrawerHeaderBand } from "./RunDrawerHeaderBand";
import { RunDrawerLoadingBody } from "./RunDrawerLoadingBody";
import {
  type RunDrawerState,
  useRunDrawerState,
  useRunDrawerStop,
  WIDE_DRAWER_MAX_WIDTH,
} from "./useRunDrawerState";

/**
 * The drawer body. A queued run draws the same as a running one, so the
 * layout does not appear piece by piece while the reader waits: only a read
 * that is still on its way, or one that failed, draws something else.
 */
function RunDrawerBody({
  state,
  stop,
}: {
  state: RunDrawerState;
  stop: ReturnType<typeof useRunDrawerStop>;
}) {
  const { detail } = state;

  // While the read is on its way the drawer must not say "Queued": that is a
  // status of the run, not a report on our own request.
  if (state.isReadingRun) return <RunDrawerLoadingBody />;
  if (state.readFailed) {
    return <RunDrawerErrorBody error={detail.runStateError} />;
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

/**
 * The header offers Open Scenario alone, so the drawer starts no run of its
 * own. A rerun goes through the run dialog, which is the one place a run plan
 * name is resolved.
 */
export function AgentTestingRunDrawer({ open }: { open?: boolean }) {
  const { closeDrawer } = useDrawer();
  const state = useRunDrawerState({ open: !!open });
  const stop = useRunDrawerStop({
    scenarioRunId: state.scenarioRunId,
    scenarioState: state.scenarioState,
  });

  return (
    <Drawer.Root
      open={!!open}
      onOpenChange={() => closeDrawer()}
      placement="end"
      size="lg"
    >
      <Drawer.Content
        bg="transparent"
        paddingX={0}
        maxWidth={WIDE_DRAWER_MAX_WIDTH}
        overflow="hidden"
        borderRadius="lg"
        data-testid="agent-testing-run-drawer"
      >
        <RunDrawerBody state={state} stop={stop} />
      </Drawer.Content>
    </Drawer.Root>
  );
}
