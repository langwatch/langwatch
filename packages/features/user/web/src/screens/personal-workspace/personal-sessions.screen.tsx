import { Skeleton, Text, VStack } from "@chakra-ui/react";

import { SessionsTable } from "@langwatch/coding-agent-web/activity";
import { PageLayout } from "@langwatch/design-system/page-layout";

import { withCodingAgentHost } from "../../ui/sections/coding-agent-host-provider";

import { usePersonalContext } from "../../behavior/use-personal-context";
import { PersonalWorkspaceLayout } from "../../ui/sections/personal-workspace-layout";

/**
 * The personal Sessions page: every coding-agent session of the last quarter
 * and what it cost in context. Routing and the layout only, the table owns its
 * own reads.
 *
 * Spec: specs/coding-agent/sessions-screen.feature.
 */
export function PersonalSessionsScreen() {
  const { ready, isPersonalProjectResolved, personalProjectId, personalProjectSlug } =
    usePersonalContext();

  return (
    <PersonalWorkspaceLayout>
      <VStack align="stretch" gap={6} width="full">
        <VStack align="start" gap={0}>
          <PageLayout.Heading>Sessions</PageLayout.Heading>
          <Text color="fg.muted" fontSize="sm">
            Every coding-agent session you ran over the last ninety days, with the context it
            carried, how often it compacted, how long it worked against how long it waited on you,
            and the pull requests it drove. Choosing a session replays it in the terminal.
          </Text>
        </VStack>

        {/* The workspace is resolved before anything is claimed about it, and
            that takes both flags: `ready` covers the session and the
            organization, and the project is read only once those land, so
            `ready` alone still leaves a window with no project id yet. Saying
            "no sessions" in that window states a fact that is not known to be
            true. */}
        {!ready || !isPersonalProjectResolved ? (
          <Skeleton height="180px" borderRadius="md" />
        ) : personalProjectId ? (
          <SessionsTable projectId={personalProjectId} projectSlug={personalProjectSlug} />
        ) : (
          <Text fontSize="sm" color="fg.muted">
            No sessions yet
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
export default withCodingAgentHost(PersonalSessionsScreen);
