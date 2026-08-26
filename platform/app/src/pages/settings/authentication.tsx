import { VStack } from "@chakra-ui/react";
import SettingsLayout from "../../components/SettingsLayout";
import { AuthenticationSettings } from "../../components/settings/AuthenticationSettings";
import { AuthenticationLayout } from "../../components/settings/authentication/AuthenticationLayout";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

/**
 * Authentication: how everyone in the organization signs in, and how their
 * accounts arrive (D05, D08, ADR-124).
 *
 * The overview of it. The identity provider's own journey and the connectors
 * that provision people are their own routes, on the rail beside this — see
 * `AuthenticationLayout` for why.
 *
 * Guarded on `sso:view` rather than on `organization:manage`: an
 * administrator who has not been given the single sign-on permissions is not
 * offered this in the menu AND cannot reach it by typing the address, which
 * is the same rule in the two places somebody could arrive from. Changing
 * anything needs `sso:manage`, which the registry's hierarchy makes a
 * superset of `sso:view`.
 */
function AuthenticationPage() {
  const { organization } = useOrganizationTeamProject();

  if (!organization) return <SettingsLayout />;

  return (
    <AuthenticationLayout>
      <VStack align="stretch" gap={6} width="full">
        <SettingsPageHeader
          title="Overview"
          description={`How everyone in ${organization.name} signs in, and how their accounts arrive.`}
        />
        <AuthenticationSettings organizationId={organization.id} />
      </VStack>
    </AuthenticationLayout>
  );
}

export default withPermissionGuard("sso:view", {
  layoutComponent: SettingsLayout,
  bypassOnboardingRedirect: true,
})(AuthenticationPage);
