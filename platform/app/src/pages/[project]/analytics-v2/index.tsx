import { Button, Center, Spinner, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import GraphsLayout from "~/components/GraphsLayout";
import { AnalyticsV2Grid } from "~/features/analytics-v2/AnalyticsV2Grid";
import { HandledErrorState } from "~/features/errors";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
// Analytics v2 runs entirely on LangWatchQL, so the same flag that gates the
// workbench gates this page. This mirrors LWQL_FLAG in
// ~/server/analytics/lwql/access.ts (client-safe, no server import).
import { LWQL_WORKBENCH_FRONTEND_FLAG } from "~/server/featureFlag/frontendFeatureFlags";

const LWQL_DISABLED_MESSAGE =
  "LangWatchQL is not enabled for this project. Ask your organization administrator to enable it to see Analytics v2.";

const LWQL_FLAG_ERROR_MESSAGE =
  "We could not check whether LangWatchQL is enabled for this project.";

interface AnalyticsV2BodyProps {
  project: { id: string; slug: string } | undefined;
  organization: { id: string } | undefined;
  workspaceError: unknown;
  lwqlEnabled: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

function AnalyticsV2Body({
  project,
  organization,
  workspaceError,
  lwqlEnabled,
  isLoading,
  isError,
  refetch,
}: AnalyticsV2BodyProps): ReactNode {
  if (workspaceError) {
    return (
      <div data-testid="analytics-v2-workspace-error">
        <HandledErrorState
          error={workspaceError}
          fallbackTitle="We couldn't open your workspace"
          fullHeight={false}
        >
          <Button
            colorPalette="orange"
            onClick={() => window.location.reload()}
            data-testid="analytics-v2-workspace-retry"
          >
            Try again
          </Button>
        </HandledErrorState>
      </div>
    );
  }

  if (!project || !organization || isLoading) {
    return (
      <Center paddingY={16} width="full" data-testid="analytics-v2-loading">
        <Spinner />
      </Center>
    );
  }

  if (isError) {
    return (
      <VStack align="start" gap={3}>
        <Text data-testid="analytics-v2-flag-error" color="fg.muted">
          {LWQL_FLAG_ERROR_MESSAGE}
        </Text>
        <Button variant="outline" onClick={() => void refetch()}>
          Try again
        </Button>
      </VStack>
    );
  }

  if (lwqlEnabled) {
    return (
      <AnalyticsV2Grid projectId={project.id} projectSlug={project.slug} />
    );
  }

  return (
    <Text data-testid="analytics-v2-lwql-disabled" color="fg.muted">
      {LWQL_DISABLED_MESSAGE}
    </Text>
  );
}

/**
 * Analytics v2: nine standard charts as inline dashboard widgets, fed by
 * LangWatchQL through the shared query API. The page owns no data — the
 * definitions live in `~/features/analytics-v2/widgets` and render through
 * the same sandboxed frame a saved dashboard uses. Gated on the project's
 * LangWatchQL enablement, since every chart depends on it. This page binds
 * only the period, so it hides the analytics filter toggle. A refused
 * workspace read renders the error state with a retry instead of the spinner.
 */
export default function AnalyticsV2Page() {
  const { project, organization, workspaceError } =
    useOrganizationTeamProject();
  const {
    enabled: lwqlEnabled,
    isLoading,
    isError,
    refetch,
  } = useFeatureFlag(LWQL_WORKBENCH_FRONTEND_FLAG, {
    projectId: project?.id,
    organizationId: organization?.id,
    enabled: !!project?.id && !!organization?.id,
  });

  return (
    <GraphsLayout
      title="Analytics v2"
      analyticsHeaderProps={{ shouldHideFilterToggle: true }}
    >
      <AnalyticsV2Body
        project={project}
        organization={organization}
        workspaceError={workspaceError}
        lwqlEnabled={lwqlEnabled}
        isLoading={isLoading}
        isError={isError}
        refetch={refetch}
      />
    </GraphsLayout>
  );
}
