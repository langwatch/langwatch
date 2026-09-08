import { Text, VStack } from "@chakra-ui/react";

import { PullRequestsTable } from "@langwatch/coding-agent-web/surfaces/activity";
import { PageLayout } from "@langwatch/design-system/page-layout";

import { withCodingAgentHost } from "../coding-agent-host-provider.tsx";

import { usePersonalContext } from "../../../behavior/use-personal-context.ts";
import { PersonalWorkspaceLayout } from "../personal-workspace-layout.tsx";

/**
 * The personal Pull Requests page: what each cost in assistant usage.
 * Which are listed is personal; the cost spans every project the viewer
 * may read. Routing and layout only, the table owns its own reads.
 */
export function PersonalPullRequestsScreen() {
  const { personalProjectId } = usePersonalContext();

  return (
    <PersonalWorkspaceLayout>
      <VStack align="stretch" gap={6} width="full">
        <VStack align="start" gap={0}>
          <PageLayout.Heading>Pull requests</PageLayout.Heading>
          <Text color="fg.muted" fontSize="sm">
            What each pull request cost in assistant usage. These are the pull requests your own
            work touched, priced across everyone who worked on them, over the pull request's whole
            life from its first session to its last rather than a selected period.
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
    </PersonalWorkspaceLayout>
  );
}

/**
 * The activity tables answer a port of their own, mounted here since
 * `@langwatch/coding-agent-web` is ungoverned and `apps/ui` may not import it.
 */
export default withCodingAgentHost(PersonalPullRequestsScreen);
