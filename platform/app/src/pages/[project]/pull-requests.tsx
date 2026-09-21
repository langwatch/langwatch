import { Skeleton, Text, VStack } from "@chakra-ui/react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { PullRequestsTable } from "~/components/me/PullRequestsTable";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import Head from "~/utils/compat/next-head";

/**
 * The project's Pull Requests page: what each pull request this project's
 * sessions touched cost in assistant usage. Routing and the layout only, the
 * table owns its own reads.
 *
 * Spec: specs/coding-agent/project-menu-links.feature.
 */
function ProjectPullRequestsPage() {
  const { project, isLoading } = useOrganizationTeamProject();

  return (
    <DashboardLayout>
      <Head>
        <title>Pull requests · LangWatch</title>
      </Head>

      <VStack align="stretch" gap={6} width="full" padding={6}>
        <VStack align="start" gap={0}>
          <PageLayout.Heading>Pull requests</PageLayout.Heading>
          <Text color="fg.muted" fontSize="sm">
            What each pull request cost in assistant usage. These are the pull
            requests this project's sessions touched, priced across everyone who
            worked on them, over the pull request's whole life from its first
            session to its last rather than a selected period.
          </Text>
        </VStack>

        {isLoading ? (
          <Skeleton height="180px" borderRadius="md" />
        ) : project ? (
          <PullRequestsTable projectId={project.id} />
        ) : (
          <Text fontSize="sm" color="fg.muted">
            No pull requests yet
          </Text>
        )}
      </VStack>
    </DashboardLayout>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled")(
  ProjectPullRequestsPage,
);
