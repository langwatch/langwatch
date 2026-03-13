import { useEffect } from "react";
import { useStreamingEventSubscription } from "~/hooks/useStreamingEventDispatch";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSimulationStreamingState } from "~/hooks/useSimulationStreamingState";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { api } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { ScenarioMessageRenderer } from "./ScenarioMessageRenderer";
import { SimulationCard } from "./SimulationCard";

const AWAITING_MESSAGES_STATUSES = new Set([
  ScenarioRunStatus.PENDING,
  ScenarioRunStatus.QUEUED,
]);

export function SimulationChatViewer({
  scenarioRunId,
  data: externalData,
}: {
  scenarioRunId: string;
  /** When provided (grid context), skip independent polling. */
  data?: ScenarioRunData;
}) {
  const { project } = useOrganizationTeamProject();

  // Only poll independently when no external data is provided (e.g. standalone usage)
  const { data: queriedData } = api.scenarios.getRunState.useQuery(
    {
      scenarioRunId,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project && !externalData,
      refetchInterval: 10_000,
    },
  );

  const data = externalData ?? queriedData;

  const { streamingMessages, handleStreamingEvent, clearCompleted } =
    useSimulationStreamingState(scenarioRunId);

  // Subscribe to the streaming event bus provided by the grid page
  useStreamingEventSubscription(handleStreamingEvent);

  // Clear streaming messages once server data includes them
  useEffect(() => {
    if (data?.messages) {
      clearCompleted(
        data.messages
          .map((m: { id?: string }) => m.id)
          .filter((id): id is string => !!id),
      );
    }
  }, [data?.messages, clearCompleted]);

  const { drawerOpen } = useDrawer();
  const drawerParams = useDrawerParams();
  const isActive =
    drawerOpen("scenarioRunDetail") &&
    drawerParams.scenarioRunId === scenarioRunId;

  const isLoading = !data;
  const isAwaitingMessages =
    !!data &&
    AWAITING_MESSAGES_STATUSES.has(data.status) &&
    (data.messages?.length ?? 0) === 0;

  return (
    <SimulationCard
      title={
        data?.name ??
        data?.scenarioId ??
        (data?.timestamp ? formatTimeAgo(data.timestamp) : undefined) ??
        ""
      }
      description={data?.description ?? undefined}
      status={data?.status}
      isActive={isActive}
      isLoading={isLoading}
      isAwaitingMessages={isAwaitingMessages}
    >
      <ScenarioMessageRenderer
        messages={data?.messages ?? []}
        streamingMessages={streamingMessages}
        variant="grid"
      />
    </SimulationCard>
  );
}
