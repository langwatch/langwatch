/**
 * Custom query — the LangWatchQL workbench, gated twice, both
 * server-answered: membership, and whether the deployment can run
 * LangWatchQL at all. Neither can be flipped from the browser.
 * @see modules/analytics/specs/analytics-lwql-workbench.feature
 */

import { Badge, Box, Spinner } from "@chakra-ui/react";

import { PageLayout } from "@langwatch/design-system/page-layout";
import { LangWatchQLWorkbench } from "../../../ui/sections/langwatch-ql-workbench-panel.tsx";
import { lwqlNotEnabledPayload, lwqlUnavailablePayload } from "../../../model/lwql-failure.ts";
import { HandledErrorAlert } from "../../../ui/elements/handled-error-alert.tsx";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { analyticsApi, type LangWatchQLUnavailableReason } from "../../../behavior/analytics-api.ts";

type AvailabilityReason = LangWatchQLUnavailableReason;

/**
 * The backend's own unavailable state, worded by the error registry: an
 * administrator-toggled switch, or a deployment with nothing to run the
 * query as. A query failure carries no `reason` and renders unmapped.
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

      {resolving && (
        <Box display="flex" justifyContent="center" paddingY={8}>
          <Spinner />
        </Box>
      )}
      {!resolving && available && (
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
      )}
      {!resolving && !available && (
        <AvailabilityFallback error={availability.error} reason={availability.data?.reason} />
      )}
    </>
  );
}

/**
 * The page guard is the routes section's, not this module's:
 * `analytics-routes.tsx` wraps these in `withPermissionGuard("analytics:view")`
 * (and `DashboardLayout` on two) — stated once, in front of the loader registry.
 */
export default CustomQueryPage;
