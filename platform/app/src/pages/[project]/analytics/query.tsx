/**
 * Custom query — the governed SQL workbench.
 *
 * Two gates, both server-answered. The permission guard decides whether this
 * member may be here at all; the availability query decides whether the
 * deployment can run a governed query. Neither can be flipped from the browser,
 * which is what keeps the surface off a deployment that has no restricted
 * identity to run a customer's SQL as.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 */

import { Badge, Box, Spinner } from "@chakra-ui/react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { GovernedSqlWorkbench } from "~/features/analytics-query/components/GovernedSqlWorkbench";
import {
  governedSqlNotEnabledPayload,
  governedSqlUnavailablePayload,
} from "~/features/analytics-query/logic/governedSqlFailure";
import { HandledErrorState } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export function CustomQueryPage() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const availability = api.analytics.governedSql.availability.useQuery(
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

  // Two different refusals: a switch the member's own administrator can turn
  // on, and a deployment that has nothing to run the query as.
  const unavailableState =
    availability.data?.reason === "disabled"
      ? governedSqlNotEnabledPayload()
      : governedSqlUnavailablePayload();

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Custom query</PageLayout.Heading>
        <Badge
          size="sm"
          variant="outline"
          title="Every statement is validated, scoped to this project, and row- and byte-limited by the server"
        >
          Governed · project-scoped
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
          <GovernedSqlWorkbench projectId={projectId} />
        </Box>
      ) : (
        // The backend's own unavailable state, worded by the error registry
        // rather than by this page.
        <HandledErrorState error={unavailableState} fullHeight={false} />
      )}
    </DashboardLayout>
  );
}

export default withPermissionGuard("analytics:view", {
  layoutComponent: DashboardLayout,
})(CustomQueryPage);
