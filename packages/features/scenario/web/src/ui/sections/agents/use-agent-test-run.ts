/**
 * "Test agent" from an agent card: schedule the one-off run and open the run
 * drawer on it right away, so the person follows the ping live.
 *
 * The drawer opens in its Agent Testing variant, the one with the judge
 * results beside the conversation, the same one the Agent Testing pages open.
 *
 * @see specs/agents/agent-test-run.feature
 */

import { useCallback } from "react";
import { showErrorToast } from "../../../behavior/errors";
import { useDrawer } from "@langwatch/ui-drawer";
import { api } from "../../../behavior/scenario-api";

export function useAgentTestRun({ projectId }: { projectId: string }) {
  const { openDrawer } = useDrawer();
  const testRun = api.agents.testRun.useMutation({
    onSuccess: ({ scenarioRunId, batchRunId }) => {
      openDrawer("scenarioRunDetail", {
        urlParams: { variant: "agent-testing", scenarioRunId, batchRunId },
      });
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't start the test run" }),
  });

  const testAgent = useCallback(
    (agentId: string) => {
      testRun.mutate({ projectId, agentId });
    },
    [projectId, testRun],
  );

  return { testAgent, isPending: testRun.isPending };
}
