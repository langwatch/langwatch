import { Center, Spinner, Text } from "@chakra-ui/react";

import GraphsLayout from "~/components/GraphsLayout";
import { AnalyticsV2Grid } from "~/features/analytics-v2/AnalyticsV2Grid";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * The LangWatchQL surface flag (`LWQL_FLAG` in
 * `~/server/analytics/lwql/access.ts`). Analytics v2 runs entirely on
 * LangWatchQL, so the same flag that gates the workbench gates this page.
 * Referenced by its literal rather than importing the server module, which
 * would pull the flag service and Prisma into the client bundle.
 */
const LWQL_FLAG = "release_lwql_workbench";

const LWQL_DISABLED_MESSAGE =
  "LangWatchQL is not enabled for this project. Ask your organization administrator to enable it to see Analytics v2.";

/**
 * Analytics v2: nine standard charts as inline dashboard widgets, fed by
 * LangWatchQL through the shared query API. The page owns no data — the
 * definitions live in `~/features/analytics-v2/widgets` and render through
 * the same sandboxed frame a saved dashboard uses. Gated on the project's
 * LangWatchQL enablement, since every chart depends on it.
 */
export default function AnalyticsV2Page() {
  const { project, organization } = useOrganizationTeamProject();
  const { enabled: lwqlEnabled, isLoading } = useFeatureFlag(LWQL_FLAG, {
    projectId: project?.id,
    organizationId: organization?.id,
    enabled: !!project?.id,
  });

  return (
    <GraphsLayout title="Analytics v2">
      {isLoading || !project ? (
        <Center paddingY={16} width="full">
          <Spinner />
        </Center>
      ) : lwqlEnabled ? (
        <AnalyticsV2Grid projectId={project.id} projectSlug={project.slug} />
      ) : (
        <Text data-testid="analytics-v2-lwql-disabled" color="fg.muted">
          {LWQL_DISABLED_MESSAGE}
        </Text>
      )}
    </GraphsLayout>
  );
}
