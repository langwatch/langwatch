/**
 * HistoryButton - Navigate to evaluation run history
 *
 * Shows a button in the V3 workbench header that links to the experiment
 * history page showing all past runs stored in Elasticsearch.
 *
 * Enabled when:
 * - User has run an evaluation this session, OR
 * - There are existing runs from a previous session (checked on page load)
 */
import { Button } from "@chakra-ui/react";
import { Clock } from "react-feather";
import { Link } from "~/components/ui/link";
import { Tooltip } from "~/components/ui/tooltip";
import { useEvaluationsV3Store } from "~/evaluations-v3/hooks/useEvaluationsV3Store";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

type HistoryButtonProps = {
  disabled?: boolean;
};

export function HistoryButton({ disabled = false }: HistoryButtonProps) {
  const { project } = useOrganizationTeamProject();

  // Get experiment info and whether we've run this session
  const { experimentId, experimentSlug, hasRunThisSession } =
    useEvaluationsV3Store((state) => ({
      experimentId: state.experimentId,
      experimentSlug: state.experimentSlug,
      hasRunThisSession: state.ui.hasRunThisSession,
    }));

  // Check if there are any runs from previous sessions (only on page load)
  const runsQuery = api.experiments.getExperimentBatchEvaluationRuns.useQuery(
    {
      projectId: project?.id ?? "",
      experimentId: experimentId ?? "",
    },
    {
      enabled: !!project && !!experimentId && !hasRunThisSession,
    },
  );

  const hasExistingRuns = (runsQuery.data?.runs.length ?? 0) > 0;
  const isLoading = runsQuery.isLoading && !hasRunThisSession;

  // Enable if we've run this session OR there are existing runs
  const hasRuns = hasRunThisSession || hasExistingRuns;

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
        disabled={disabled || !hasRuns || isLoading}
        aria-label="View run history"
        asChild
      >
        <Link href={`/${project.slug}/experiments/${experimentSlug}`}>
          <Clock size={14} />
          History
        </Link>
      </Button>
    </Tooltip>
  );
}
