import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { ScenarioRunData } from "~/app/api/scenario-events/[[...route]]/types";
import { useTracedQuery } from "~/observability/react-otel/useTracedQuery";

type ChildProps = Omit<
  ReturnType<typeof api.scenarios.getRunState.useQuery>,
  "data"
> & {
  data?: ScenarioRunData | null;
};

interface SimulationChatViewerWrapperProps {
  scenarioRunId: string;
  children: (props: ChildProps) => React.ReactNode;
}

/**
 * Wrapper component that provides simulation data to child components
 * Handles data fetching and provides simulation state to children
 *
 * @example
 * ```tsx
 * <SimulationChatViewerWrapper scenarioRunId="run-123">
 *   {({ data, isLoading, error }) => (
 *     <CustomSimulationDisplay
 *       title={data?.name}
 *       status={data?.status}
 *       messages={data?.messages}
 *       isLoading={isLoading}
 *     />
 *   )}
 * </SimulationChatViewerWrapper>
 * ```
 */
export const SimulationChatWrapper: React.FC<
  SimulationChatViewerWrapperProps
> = ({ scenarioRunId, children }) => {
  const { project } = useOrganizationTeamProject();
  const query = useTracedQuery(api.scenarios.getRunState,
    {
      scenarioRunId,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project && !!scenarioRunId,
      refetchInterval: 1000,
    },
  );

  return <>{children(query)}</>;
};
