import { VStack } from "@chakra-ui/react";
import { AuthenticationLayout } from "../../../components/settings/authentication/AuthenticationLayout";
import { SettingsPageHeader } from "../../../components/settings/SettingsPageHeader";
import { SingleSignOnSetup } from "../../../components/settings/SingleSignOnSetup";
import SettingsLayout from "../../../components/SettingsLayout";
import { withPermissionGuard } from "../../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";

/**
 * The identity provider, all the way from nothing to live (D05 tiers 2 and 3,
 * D09, ADR-124).
 *
 * A ROUTE RATHER THAN A MODE. The journey used to share an address with the
 * overview and swap places with it, so one navigation entry was two screens
 * and pressing "manage" took the cards away from the reader who pressed it.
 * It has a page now, the overview links into it, and the rail says where you
 * are.
 *
 * SIX STEPS, IN THE ORDER THE WORK HAPPENS IN. Tell us about the identity
 * provider, prove a domain is yours, sign in through it once, name somebody
 * who can still get in without it, say who it lets in, turn it on. The
 * connection's own state machine says which step an organization is on, so
 * this screen remembers nothing — reload it halfway through and it resumes
 * exactly where the aggregate says the customer is.
 */
function IdentityProviderPage() {
  const { organization } = useOrganizationTeamProject();

  if (!organization) return <SettingsLayout />;

  return (
    <AuthenticationLayout>
      <VStack align="stretch" gap={6} width="full">
        <SettingsPageHeader
          title="Identity provider"
          description="Where your people sign in, and everything it takes to put it in front of them."
        />
        <SingleSignOnSetup organizationId={organization.id} />
      </VStack>
    </AuthenticationLayout>
  );
}

export default withPermissionGuard("sso:view", {
  layoutComponent: SettingsLayout,
  bypassOnboardingRedirect: true,
})(IdentityProviderPage);
