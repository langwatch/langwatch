import { Skeleton, Text, VStack } from "@chakra-ui/react";

import { PullRequestsTable } from "@langwatch/coding-agent-web/activity";
import { PageLayout } from "@langwatch/design-system/page-layout";

import { withCodingAgentHost } from "../../ui/sections/coding-agent-host-provider";

import { useOrganizationTeamProject } from "../../behavior/personal-workspace-session";

/**
 * The project's Pull Requests page: what each pull request this project's
 * sessions touched cost in assistant usage. Routing and the layout only, the
 * table owns its own reads.
 *
 * Spec: specs/coding-agent/project-menu-links.feature.
 */
export function ProjectPullRequestsScreen() {
  const { project, isResolved } = useOrganizationTeamProject();

  return (
    <VStack align="stretch" gap={6} width="full" padding={6}>
      <VStack align="start" gap={0}>
        <PageLayout.Heading>Pull requests</PageLayout.Heading>
        <Text color="fg.muted" fontSize="sm">
          What each pull request cost in assistant usage. These are the pull requests this project's
          sessions touched, priced across everyone who worked on them, over the pull request's whole
          life from its first session to its last rather than a selected period.
        </Text>
      </VStack>

      {!isResolved ? (
        <Skeleton height="180px" borderRadius="md" />
      ) : project ? (
        <PullRequestsTable projectId={project.id} />
      ) : (
        <Text fontSize="sm" color="fg.muted">
          No pull requests yet
        </Text>
      )}
    </VStack>
  );
}

/**
 * The activity tables answer a port of their own, and this screen is what
 * mounts it: `@langwatch/coding-agent-web` is not a governed web package, so
 * `apps/ui` may not import it, and the screen family that renders its tables
 * is where the bridge belongs.
 */
export default withCodingAgentHost(ProjectPullRequestsScreen);
