import { Heading, VStack } from "@chakra-ui/react";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import {
  PeopleSpendPanel,
  SPEND_SORT_LABEL,
} from "~/components/governance/PeopleTable";
import { PermissionRequiredNotice } from "~/components/PermissionRequiredNotice";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSpendSortParam } from "~/hooks/useSpendSortParam";

/**
 * The full ranking of people by spend. Its address redirects to the People
 * tab of /governance/people (see `legacyRedirects.tsx`); this page keeps
 * the same table for the detail page's neighbourhood and renders nothing
 * of its own.
 */
function GovernanceUsersListPage() {
  const { organization, hasAnyPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";
  const canReadActivity = hasAnyPermission("activityMonitor:view");
  const canReadSources = hasAnyPermission("ingestionSources:view");
  const { sortBy, setSortBy } = useSpendSortParam();

  return (
    <GovernanceLayout pageTitle="People · AI Governance · LangWatch">
      <VStack align="stretch" gap={4} width="full" maxW="container.xl">
        <Heading size="md">All people by {SPEND_SORT_LABEL[sortBy]}</Heading>

        {canReadActivity ? (
          <PeopleSpendPanel
            orgId={orgId}
            sortBy={sortBy}
            onSortChange={setSortBy}
            canReadSources={canReadSources}
          />
        ) : (
          <PermissionRequiredNotice
            permission="activityMonitor:view"
            detail="Spend and activity per person stay hidden until then."
          />
        )}
      </VStack>
    </GovernanceLayout>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withPermissionGuard("governance:view", {
    bypassOnboardingRedirect: true,
  })(GovernanceUsersListPage),
);
