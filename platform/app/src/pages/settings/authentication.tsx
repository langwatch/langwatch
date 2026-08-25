import { Heading, Text, VStack } from "@chakra-ui/react";
import SettingsLayout from "../../components/SettingsLayout";
import { AuthenticationSettings } from "../../components/settings/AuthenticationSettings";
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
      <VStack
        align="stretch"
        gap={6}
        padding={6}
        width="full"
        maxWidth="1120px"
      >
        <VStack align="start" gap={1}>
          <Heading>Authentication</Heading>
          <Text color="fg.muted" fontSize="sm">
            {`How everyone in ${organization.name} signs in, and how their accounts arrive.`}
          </Text>
        </VStack>
        <AuthenticationSettings organizationId={organization.id} />
      </VStack>
    </SettingsLayout>
  );
}

export default withPermissionGuard("sso:view", {
  layoutComponent: SettingsLayout,
  bypassOnboardingRedirect: true,
})(AuthenticationPage);
