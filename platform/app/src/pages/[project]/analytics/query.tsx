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

import { Box, Spinner, Text, VStack } from "@chakra-ui/react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { GovernedSqlWorkbench } from "~/features/analytics-query/components/GovernedSqlWorkbench";
import { governedSqlUnavailablePayload } from "~/features/analytics-query/logic/governedSqlFailure";
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

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Custom query</PageLayout.Heading>
      </PageLayout.Header>

      {resolving ? (
        <Box display="flex" justifyContent="center" paddingY={8}>
          <Spinner />
        </Box>
      ) : available ? (
        <Box width="full" paddingX={6} paddingY={4}>
          <VStack align="stretch" gap={4} width="full">
            <Text color="fg.muted" fontSize="13px">
              Write governed ClickHouse SQL over the analytics datasets you can
              reach.
            </Text>
            <GovernedSqlWorkbench projectId={projectId} />
          </VStack>
        </Box>
      ) : (
        // The backend's own unavailable state, worded by the error registry
        // rather than by this page.
        <HandledErrorState
          error={governedSqlUnavailablePayload()}
          fullHeight={false}
        />
      )}
    </DashboardLayout>
  );
}

export default withPermissionGuard("analytics:view", {
  layoutComponent: DashboardLayout,
})(CustomQueryPage);
