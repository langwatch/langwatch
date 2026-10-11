import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Text, VStack } from "@langwatch/design-system/primitives";

import { CodingAgentPullRequestsTable } from "../../../behavior/lent-coding-agent-tables.tsx";
import { usePersonalRouter } from "../../../behavior/personal-workspace-router.ts";
import { usePersonalContext } from "../../../behavior/use-personal-context.ts";
import { PersonalWorkspaceLayout } from "../personal-workspace-layout.tsx";

/**
 * The personal Pull Requests page: what each cost in assistant usage.
 * Which are listed is personal; the cost spans every project the viewer
 * may read. Routing and layout only, the table owns its own reads.
 */
export function PersonalPullRequestsScreen() {
  const router = usePersonalRouter();
  const { personalProjectId } = usePersonalContext();

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Pull requests</PageLayout.Heading>
      </PageLayout.Header>
      <PersonalWorkspaceLayout>
        <VStack align="stretch" gap={6} width="full">
          <VStack align="start" gap={0}>
            <Text color="fg.muted" fontSize="sm">
              What each pull request cost in assistant usage. These are the pull requests your own
              work touched, priced across everyone who worked on them, over the pull request's whole
              life from its first session to its last rather than a selected period.
            </Text>
          </VStack>

          {personalProjectId ? (
            <CodingAgentPullRequestsTable projectId={personalProjectId} />
          ) : (
            <NoDataInfoBlock
              size="line"
              title="No pull requests yet"
              next={[
                {
                  kind: "setting",
                  label: "Connect your AI tools",
                  href: "/me/configure",
                  onNavigate: ({ href }) => router.push(href),
                },
              ]}
            />
          )}
        </VStack>
      </PersonalWorkspaceLayout>
    </>
  );
}

export default PersonalPullRequestsScreen;
