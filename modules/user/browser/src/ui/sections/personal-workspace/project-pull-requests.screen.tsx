import { Skeleton, Text, VStack } from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";

import { CodingAgentPullRequestsTable } from "../../../behavior/lent-coding-agent-tables.tsx";
import { useOrganizationTeamProject } from "../../../behavior/personal-workspace-session.ts";

/**
 * The project's Pull Requests page: what each pull request its sessions
 * touched cost in assistant usage. Routing and layout only, the table
 * owns its own reads. Spec: specs/coding-agent/project-menu-links.feature.
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

      {!isResolved && <Skeleton height="180px" borderRadius="md" />}
      {isResolved && project ? <CodingAgentPullRequestsTable projectId={project.id} /> : null}
      {isResolved && !project && (
        <Text fontSize="sm" color="fg.muted">
          No pull requests yet
        </Text>
      )}
    </VStack>
  );
}

export default ProjectPullRequestsScreen;
