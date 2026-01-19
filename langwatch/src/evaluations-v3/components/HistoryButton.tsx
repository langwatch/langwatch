/**
 * HistoryButton - Navigate to evaluation run history
 *
 * Shows a button in the V3 workbench header that links to the experiment
 * history page showing all past runs stored in Elasticsearch.
 */
import { Button } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { Clock } from "react-feather";
import { Tooltip } from "~/components/ui/tooltip";
import { useEvaluationsV3Store } from "~/evaluations-v3/hooks/useEvaluationsV3Store";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

type HistoryButtonProps = {
  disabled?: boolean;
};

export function HistoryButton({ disabled = false }: HistoryButtonProps) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  // Get the actual experiment ID from the store (set when experiment is loaded/created)
  const { experimentId, experimentSlug } = useEvaluationsV3Store((state) => ({
    experimentId: state.experimentId,
    experimentSlug: state.experimentSlug,
  }));

  // Check if there are any runs for this experiment
  // Use the actual experimentId, not the slug!
  const runsQuery = api.experiments.getExperimentBatchEvaluationRuns.useQuery(
    {
      projectId: project?.id ?? "",
      experimentId: experimentId ?? "",
    },
    {
      enabled: !!project && !!experimentId,
    },
  );

  const hasRuns = (runsQuery.data?.runs.length ?? 0) > 0;
  const isLoading = runsQuery.isLoading;

  const handleClick = () => {
    if (!project || !experimentSlug) return;
    void router.push(`/${project.slug}/experiments/${experimentSlug}`);
  };

  // Don't show if no project or experimentId
  if (!project || !experimentId) return null;

  return (
    <Tooltip
      content={hasRuns ? "View run history" : "No runs yet"}
      showArrow
      positioning={{ placement: "bottom" }}
      openDelay={100}
    >
      <Button
        size="xs"
        variant="ghost"
        onClick={handleClick}
        disabled={disabled || !hasRuns || isLoading}
        aria-label="View run history"
      >
        <Clock size={14} />
        History
      </Button>
    </Tooltip>
  );
}
