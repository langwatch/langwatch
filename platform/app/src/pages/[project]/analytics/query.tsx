/**
 * Custom query — the LangWatchQL workbench.
 *
 * Two gates, both server-answered. The permission guard decides whether this
 * member may be here at all; the availability query decides whether the
 * deployment can run a LangWatchQL query. Neither can be flipped from the browser,
 * which is what keeps the surface off a deployment that has no restricted
 * identity to run a customer's SQL as.
 *
 * @see specs/analytics/lwql-workbench.feature
 */

import { Badge, Box, Spinner } from "@chakra-ui/react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { LangWatchQLWorkbench } from "~/features/analytics-query/components/LangWatchQLWorkbench";
import {
  lwqlNotEnabledPayload,
  lwqlUnavailablePayload,
} from "~/features/analytics-query/logic/lwqlFailure";
import { HandledErrorState } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";

type AvailabilityReason =
  RouterOutputs["analytics"]["lwql"]["availability"]["reason"];

/**
 * The backend's own unavailable state, worded by the error registry rather
 * than by this page. Two different refusals, both backend availability
 * data: a switch the member's own administrator can turn on, and a
 * deployment that has nothing to run the query as. A query failure is a
 * third, distinct case — it carries no `reason` and must not be read as
 * either, so it renders through the same registry unmapped.
 */
function AvailabilityFallback({
  error,
  reason,
}: {
  error: unknown;
  reason: AvailabilityReason | undefined;
}) {
  if (error) {
    return <HandledErrorState error={error} fullHeight={false} />;
  }

  const unavailableState =
    reason === "disabled" ? lwqlNotEnabledPayload() : lwqlUnavailablePayload();

  return <HandledErrorState error={unavailableState} fullHeight={false} />;
}

export function CustomQueryPage() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const availability = api.analytics.lwql.availability.useQuery(
    { projectId },
    {
      enabled: projectId.length > 0,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      staleTime: Number.POSITIVE_INFINITY,
    },
  );

  const available = availability.data?.available === true;
  const resolving = projectId.length === 0 || availability.isLoading;

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Custom query</PageLayout.Heading>
        <Badge
          size="sm"
          variant="outline"
          title="Every statement is validated, scoped to this project, and row- and byte-limited by the server"
        >
          LangWatchQL · project-scoped
        </Badge>
      </PageLayout.Header>

      {resolving ? (
        <Box display="flex" justifyContent="center" paddingY={8}>
          <Spinner />
        </Box>
      ) : available ? (
        <Box
          width="full"
          flex="1"
          minHeight={0}
          display="flex"
          flexDirection="column"
        >
          {/*
            Keyed on the project so switching projects starts a clean
            workbench. The query controller holds the draft, the submitted
            snapshot and the outcome; without this key they survive the switch,
            the pane calls the carried-over result "Current", and "run again"
            would submit the previous project's statement against the new one.
          */}
          <LangWatchQLWorkbench key={projectId} projectId={projectId} />
        </Box>
      ) : (
        <AvailabilityFallback
          error={availability.error}
          reason={availability.data?.reason}
        />
      )}
    </DashboardLayout>
  );
}

export default withPermissionGuard("analytics:view", {
  layoutComponent: DashboardLayout,
})(CustomQueryPage);
