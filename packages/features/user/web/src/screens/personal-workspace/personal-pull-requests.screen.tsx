import { Text, VStack } from "@chakra-ui/react";

import { PullRequestsTable } from "@langwatch/coding-agent-web/activity";
import { PageLayout } from "@langwatch/design-system/page-layout";

import { withCodingAgentHost } from "../../ui/sections/coding-agent-host-provider";

import { usePersonalContext } from "../../behavior/use-personal-context";
import { PersonalWorkspaceLayout } from "../../ui/sections/personal-workspace-layout";

/**
 * The personal Pull Requests page: what each pull request cost in assistant
 * usage. Which pull requests are listed is personal; what each one cost spans
 * every project the viewer may read. Routing and the layout only, the table
 * owns its own reads.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
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
 * The activity tables answer a port of their own, and this screen is what
 * mounts it: `@langwatch/coding-agent-web` is not a governed web package, so
 * `apps/ui` may not import it, and the screen family that renders its tables
 * is where the bridge belongs.
 */
export default withCodingAgentHost(PersonalPullRequestsScreen);
