/**
 * "Test agent" from an agent card: schedule the one-off run and open the run
 * drawer on it right away, so the person follows the ping live.
 *
 * @see specs/agents/agent-test-run.feature
 */

import { useCallback } from "react";
import { showErrorToast } from "~/features/errors";
import { useDrawer } from "~/hooks/useDrawer";
import { api } from "~/utils/api";

export function useAgentTestRun({ projectId }: { projectId: string }) {
  const { openDrawer } = useDrawer();
  const testRun = api.agents.testRun.useMutation({
    onSuccess: ({ scenarioRunId }) => {
      openDrawer("scenarioRunDetail", { urlParams: { scenarioRunId } });
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't start the test run" }),
  });

  const testAgent = useCallback(
    (agentId: string) => {
      testRun.mutate({ projectId, agentId });
    },
    [projectId, testRun],
  );

  return { testAgent, isPending: testRun.isPending };
}
