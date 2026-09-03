import { Skeleton, Text, VStack } from "@chakra-ui/react";

import { SessionsTable } from "@langwatch/coding-agent-web/activity";
import { PageLayout } from "@langwatch/design-system/page-layout";

import { withCodingAgentHost } from "../../ui/sections/coding-agent-host-provider";

import { useOrganizationTeamProject } from "../../behavior/personal-workspace-session";

/**
 * The project's Sessions page: every coding-agent session this project
 * recorded, and what it cost in context. Routing and the layout only, the
 * table owns its own reads.
 *
 * Spec: specs/coding-agent/project-menu-links.feature.
 */
export function ProjectSessionsScreen() {
  const { project, isResolved } = useOrganizationTeamProject();

  return (
    <VStack align="stretch" gap={6} width="full" padding={6}>
      <VStack align="start" gap={0}>
        <PageLayout.Heading>Sessions</PageLayout.Heading>
        <Text color="fg.muted" fontSize="sm">
          Every coding-agent session this project recorded over the last ninety days, with the
          context it carried, how often it compacted, how long it worked against how long it waited
          on a person, and the pull requests it drove. Choosing a session replays it in the
          terminal.
        </Text>
      </VStack>

      {/* The project is resolved before anything is claimed about it.
            Saying "no sessions" while the project is still loading states a
            fact that is not known to be true. */}
      {!isResolved ? (
        <Skeleton height="180px" borderRadius="md" />
      ) : project ? (
        <SessionsTable projectId={project.id} projectSlug={project.slug} />
      ) : (
        <Text fontSize="sm" color="fg.muted">
          No sessions yet
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
export default withCodingAgentHost(ProjectSessionsScreen);
