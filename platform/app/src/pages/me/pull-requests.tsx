import { Text, VStack } from "@chakra-ui/react";

import MyLayout from "~/components/me/MyLayout";
import { PullRequestsTable } from "~/components/me/PullRequestsTable";
import { usePersonalContext } from "~/components/me/usePersonalContext";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import Head from "~/utils/compat/next-head";

/**
 * The personal Pull Requests page: what each pull request cost in assistant
 * usage. Which pull requests are listed is personal; what each one cost spans
 * every project the viewer may read. Routing and the layout only, the table
 * owns its own reads.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */
function MyPullRequestsPage() {
  const { personalProjectId } = usePersonalContext();

  return (
    <MyLayout>
      <Head>
        <title>My Pull Requests · LangWatch</title>
      </Head>

      <VStack align="stretch" gap={6} width="full">
        <VStack align="start" gap={0}>
          <PageLayout.Heading>Pull requests</PageLayout.Heading>
          <Text color="fg.muted" fontSize="sm">
            What each pull request cost in assistant usage. These are the pull requests
            your own work touched, priced across everyone who worked on them, over the
            pull request's whole life from its first session to its last rather than a
            selected period.
          </Text>
        </VStack>

        {personalProjectId ? (
          <PullRequestsTable projectId={personalProjectId} />
        ) : (
          <Text fontSize="sm" color="fg.muted">
            No pull requests yet
          </Text>
        )}
      </VStack>
    </MyLayout>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(MyPullRequestsPage);
