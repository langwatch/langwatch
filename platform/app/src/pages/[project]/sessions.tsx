import { Skeleton, Text, VStack } from "@chakra-ui/react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { SessionsTable } from "~/components/me/SessionsTable";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import Head from "~/utils/compat/next-head";

/**
 * The project's Sessions page: every coding-agent session this project
 * recorded, and what it cost in context. Routing and the layout only, the
 * table owns its own reads.
 *
 * Spec: specs/coding-agent/project-menu-links.feature.
 */
function ProjectSessionsPage() {
  const { project, isLoading } = useOrganizationTeamProject();

  return (
    <DashboardLayout>
      <Head>
        <title>Sessions · LangWatch</title>
      </Head>

      <VStack align="stretch" gap={6} width="full" padding={6}>
        <VStack align="start" gap={0}>
          <PageLayout.Heading>Sessions</PageLayout.Heading>
          <Text color="fg.muted" fontSize="sm">
            Every coding-agent session this project recorded over the last ninety days,
            with the context it carried, how often it compacted, how long it worked
            against how long it waited on a person, and the pull requests it drove.
            Choosing a session replays it in the terminal.
          </Text>
        </VStack>

        {/* The project is resolved before anything is claimed about it.
            Saying "no sessions" while the project is still loading states a
            fact that is not known to be true. */}
        {isLoading ? (
          <Skeleton height="180px" borderRadius="md" />
        ) : project ? (
          <SessionsTable projectId={project.id} projectSlug={project.slug} />
        ) : (
          <Text fontSize="sm" color="fg.muted">
            No sessions yet
          </Text>
        )}
      </VStack>
    </DashboardLayout>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled")(
  ProjectSessionsPage,
);
