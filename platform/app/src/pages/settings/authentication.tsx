import { VStack } from "@chakra-ui/react";
import SettingsLayout from "../../components/SettingsLayout";
import { AuthenticationSettings } from "../../components/settings/AuthenticationSettings";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

/**
 * Authentication: how everyone in the organization signs in, and how their
 * accounts arrive (D05, D08, ADR-124).
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
    <SettingsLayout>
      {/* No padding and no width cap of its own: `SettingsLayout` already
          wraps every settings page in a padded, capped container, so the ones
          this page added indented it inside an indent and made it narrower
          than the three pages beside it. */}
      <VStack align="stretch" gap={6} width="full">
        <SettingsPageHeader
          title="Authentication"
          description={`How everyone in ${organization.name} signs in, and how their accounts arrive.`}
        />
        <AuthenticationSettings organizationId={organization.id} />
      </VStack>
    </SettingsLayout>
  );
}

export default withPermissionGuard("sso:view", {
  layoutComponent: SettingsLayout,
  bypassOnboardingRedirect: true,
})(AuthenticationPage);
