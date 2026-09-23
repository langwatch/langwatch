import { useDrawer } from "@langwatch/browser-host/drawer";
import { useRouter } from "@langwatch/browser-host/use-router";
import { useDejaViewLink } from "@langwatch/workflow-browser/surfaces/deja-view-link";
import { useCallback, useState } from "react";

import { api } from "../../../behavior/scenario-api.ts";
import { useRunDetailFacts } from "../../../behavior/simulations/use-run-detail-facts.ts";
import { useRunStateStream } from "../../../behavior/simulations/use-run-state-stream.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { useRunAgainActions } from "./use-run-again-actions.ts";

/**
 * Whole-conversation view in Trace Explorer: every trace of this run carries the
 * scenario.run_id attribute, so a scenarioRun:"<id>" search shows the full
 * conversation. Same #<lens>?q= fragment contract as the command bar's trace links.
 */
function useOpenRunInTraces({
  projectSlug,
  scenarioRunId,
}: {
  projectSlug: string | undefined;
  scenarioRunId: string | undefined;
}) {
  const router = useRouter();

  return useCallback(() => {
    if (!projectSlug || !scenarioRunId) return;
    const query = encodeURIComponent(`scenarioRun:"${scenarioRunId}"`);
    void router.push(`/${projectSlug}/traces#all-traces?q=${query}`);
  }, [projectSlug, scenarioRunId, router]);
}

/**
 * Everything the run detail drawer knows about one run: the live state, the streamed
 * messages, the scenario record, and the actions on it. Shared by the classic drawer
 * and the Agent Testing variant so the two layouts read the same run the same way.
 */
export function useScenarioRunDetail({
  scenarioRunId,
  open,
}: {
  scenarioRunId: string | undefined;
  open: boolean;
}) {
  const { openDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();
  const [scenarioEditorOpen, setScenarioEditorOpen] = useState(false);

  const dejaView = useDejaViewLink({
    aggregateId: scenarioRunId,
    tenantId: project?.id,
  });

  const stream = useRunStateStream({
    scenarioRunId,
    projectId: project?.id,
    isOpen: open,
  });
  const scenarioId = stream.scenarioState?.scenarioId;
  const batchRunId = stream.scenarioState?.batchRunId;

  const { data: scenarioData } = api.scenarios.getByIdIncludingArchived.useQuery(
    { projectId: project?.id ?? "", id: scenarioId ?? "" },
    { enabled: !!project?.id && !!scenarioId },
  );

  const facts = useRunDetailFacts({
    scenarioState: stream.scenarioState,
    streamingMessages: stream.streamingMessages,
    scenarioRunId,
    isOpen: open,
  });
  const actions = useRunAgainActions({
    scenarioId,
    projectId: project?.id,
    projectSlug: project?.slug,
  });
  const handleOpenInTraces = useOpenRunInTraces({
    projectSlug: project?.slug,
    scenarioRunId,
  });

  return {
    project,
    openDrawer,
    scenarioId,
    batchRunId,
    scenarioData,
    dejaView,
    scenarioEditorOpen,
    setScenarioEditorOpen,
    handleOpenInTraces,
    ...stream,
    ...facts,
    ...actions,
  };
}

export type ScenarioRunDetail = ReturnType<typeof useScenarioRunDetail>;
