import { PageLayout } from "@langwatch/design-system/page-layout";
import { Skeleton, Text, VStack } from "@langwatch/design-system/primitives";

import { CodingAgentSessionsTable } from "../../../behavior/lent-coding-agent-tables.tsx";
import { useOrganizationTeamProject } from "../../../behavior/personal-workspace-session.ts";

/**
 * The project's Sessions page: every coding-agent session it recorded, and
 * its context cost. Routing and layout only, the table owns its own
 * reads. Spec: specs/coding-agent/project-menu-links.feature.
 */
export function ProjectSessionsScreen() {
  const { project, isResolved } = useOrganizationTeamProject();

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Sessions</PageLayout.Heading>
      </PageLayout.Header>
      <VStack align="stretch" gap={6} width="full" padding={6}>
        <VStack align="start" gap={0}>
          <Text color="fg.muted" fontSize="sm">
            Every coding-agent session this project recorded over the last ninety days, with the
            context it carried, how often it compacted, how long it worked against how long it
            waited on a person, and the pull requests it drove. Choosing a session replays it in the
            terminal.
          </Text>
        </VStack>

        {/* The project is resolved before anything is claimed about it.
            Saying "no sessions" while the project is still loading states a
            fact that is not known to be true. */}
        {!isResolved && <Skeleton height="180px" borderRadius="md" />}
        {isResolved && project ? (
          <CodingAgentSessionsTable projectId={project.id} projectSlug={project.slug} />
        ) : null}
        {isResolved && !project && (
          <Text fontSize="sm" color="fg.muted">
            No sessions yet
          </Text>
        )}
      </VStack>
    </>
  );
}

export default ProjectSessionsScreen;
