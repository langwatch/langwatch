/**
 * Custom query — the LangWatchQL workbench.
 *
 * Two gates, both server-answered. The permission guard decides whether this
 * member may be here at all; the availability query decides whether the
 * deployment can run a LangWatchQL query. Neither can be flipped from the browser,
 * which is what keeps the surface off a deployment that has no restricted
 * identity to run a customer's SQL as.
 *
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { Badge, Box, Spinner } from "@chakra-ui/react";

import { PageLayout } from "@langwatch/design-system/page-layout";
import { LangWatchQLWorkbench } from "../../ui/sections/langwatch-ql-workbench-panel";
import { lwqlNotEnabledPayload, lwqlUnavailablePayload } from "../../model/lwql-failure";
import { HandledErrorAlert } from "../../ui/elements/handled-error-alert";
import { useAnalyticsHost } from "../../model/analytics-host";
import { analyticsApi, type LangWatchQLUnavailableReason } from "../../behavior/analytics-api";

type AvailabilityReason = LangWatchQLUnavailableReason;

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
    return <HandledErrorAlert error={error} fallbackTitle="Couldn't load the workbench" />;
  }

  const unavailableState =
    reason === "disabled" ? lwqlNotEnabledPayload() : lwqlUnavailablePayload();

  return (
    <HandledErrorAlert
      error={unavailableState}
      fallbackTitle="Custom query is not available on this deployment"
    />
  );
}

export function CustomQueryPage() {
  const host = useAnalyticsHost();
  const project = host.project();
  const projectId = project?.id ?? "";

  const availability = analyticsApi.analytics.lwql.availability.useQuery(
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
    <>
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
        <Box width="full" flex="1" minHeight={0} display="flex" flexDirection="column">
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
        <AvailabilityFallback error={availability.error} reason={availability.data?.reason} />
      )}
    </>
  );
}

/**
 * The page guard is the routes section's, not this module's.
 *
 * `platform/app` wrapped each of these in `withPermissionGuard("analytics:view")`
 * — and, on two of them, in `DashboardLayout` as well. Both are the composing
 * application's: the policy is stated once in
 * `apps/ui/src/features/analytics/ui/sections/analytics-routes.tsx`, in front of
 * the same loader registry, and the chrome belongs to the route tree these
 * screens are children of.
 */
export default CustomQueryPage;
