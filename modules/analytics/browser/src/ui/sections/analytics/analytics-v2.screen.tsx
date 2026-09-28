/**
 * Analytics v2: nine dashboard-widget charts over LangWatchQL, gated by the
 * release_analytics_v2 flag then the project's LangWatchQL availability.
 * Definitions live in the analytics-v2 feature; @see specs/analytics-v2.feature.
 */

import { Center, Spinner, Text } from "@chakra-ui/react";
import { useFeatureFlag } from "@langwatch/browser-host/feature-flag";
import type { ReactNode } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { AnalyticsV2Grid } from "../../../features/analytics-v2/ui/sections/analytics-v2-grid.tsx";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import AnalyticsLayout from "../analytics-layout.tsx";

const ANALYTICS_V2_NOT_AVAILABLE_MESSAGE = "Analytics v2 is not available for this project yet.";

const LWQL_DISABLED_MESSAGE =
  "LangWatchQL is not enabled for this project. Ask your organization administrator to enable it to see Analytics v2.";

export function AnalyticsV2Page() {
  const host = useAnalyticsHost();
  const project = host.project();
  const projectId = project?.id ?? "";
  const organizationId = host.organizationId();

  const { enabled: analyticsV2Enabled, isLoading: flagLoading } = useFeatureFlag(
    "release_analytics_v2",
    {
      projectId: project?.id,
      organizationId,
      enabled: !!project?.id && !!organizationId,
    },
  );

  const availability = analyticsApi.analytics.lwql.availability.useQuery(
    { projectId },
    {
      enabled: projectId.length > 0 && analyticsV2Enabled,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      staleTime: Number.POSITIVE_INFINITY,
    },
  );

  function body(): ReactNode {
    if (!project || flagLoading) {
      return (
        <Center paddingY={16} width="full" data-testid="analytics-v2-loading">
          <Spinner />
        </Center>
      );
    }

    if (!analyticsV2Enabled) {
      return (
        <Text data-testid="analytics-v2-not-available" color="fg.muted">
          {ANALYTICS_V2_NOT_AVAILABLE_MESSAGE}
        </Text>
      );
    }

    if (availability.isLoading) {
      return (
        <Center paddingY={16} width="full" data-testid="analytics-v2-loading">
          <Spinner />
        </Center>
      );
    }

    if (availability.data?.available !== true) {
      return (
        <Text data-testid="analytics-v2-lwql-disabled" color="fg.muted">
          {LWQL_DISABLED_MESSAGE}
        </Text>
      );
    }

    return <AnalyticsV2Grid projectId={project.id} projectSlug={project.slug} />;
  }

  return <AnalyticsLayout title="Analytics v2">{body()}</AnalyticsLayout>;
}

/**
 * No client-side permission guard, same as the sibling analytics screens: the
 * LangWatchQL and flag endpoints enforce project access on the server.
 */
export default AnalyticsV2Page;
