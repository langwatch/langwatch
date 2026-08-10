import { Text, VStack } from "@chakra-ui/react";

import MyLayout from "~/components/me/MyLayout";
import { SessionsTable } from "~/components/me/SessionsTable";
import { usePersonalContext } from "~/components/me/usePersonalContext";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import Head from "~/utils/compat/next-head";

/**
 * The personal Sessions page: every coding-agent session of the last quarter
 * and what it cost in context. Routing and the layout only, the table owns its
 * own reads.
 *
 * Spec: specs/coding-agent/sessions-screen.feature.
 */
function MySessionsPage() {
  const { personalProjectId, personalProjectSlug } = usePersonalContext();

  return (
    <MyLayout>
      <Head>
        <title>My Sessions · LangWatch</title>
      </Head>

      <VStack align="stretch" gap={6} width="full">
        <VStack align="start" gap={0}>
          <PageLayout.Heading>Sessions</PageLayout.Heading>
          <Text color="fg.muted" fontSize="sm">
            Every coding-agent session you ran over the last ninety days, with
            the context it carried, how often it compacted, how long it worked
            against how long it waited on you, and the pull requests it drove.
            Choosing a session replays it in the terminal.
          </Text>
        </VStack>

        {personalProjectId ? (
          <SessionsTable
            projectId={personalProjectId}
            projectSlug={personalProjectSlug}
          />
        ) : (
          <Text fontSize="sm" color="fg.muted">
            No sessions yet
          </Text>
        )}
      </VStack>
    </MyLayout>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(MySessionsPage);
