import { Heading, Text, VStack } from "@chakra-ui/react";
import SettingsLayout from "../../components/SettingsLayout";
import { SingleSignOnSetup } from "../../components/settings/SingleSignOnSetup";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

/**
 * Setting enterprise single sign-on up yourself (D05 tiers 2 and 3).
 *
 * Guarded on `sso:view` rather than on `organization:manage`: an
 * administrator who has not been given the single sign-on permissions is not
 * offered this in the menu AND cannot reach it by typing the address, which
 * is the same rule in the two places somebody could arrive from. Changing
 * anything needs `sso:manage`, which the registry's hierarchy makes a
 * superset of `sso:view`.
 */
function SingleSignOnSettings() {
  const { organization } = useOrganizationTeamProject();

  if (!organization) return <SettingsLayout />;

  return (
    <SettingsLayout>
      <VStack align="stretch" gap={6} padding={6} width="full" maxWidth="920px">
        <VStack align="start" gap={1}>
          <Heading size="lg">Single sign-on</Heading>
          <Text color="gray.600">
            Let people sign in to LangWatch with your company&apos;s identity
            provider.
          </Text>
        </VStack>
        <SingleSignOnSetup organizationId={organization.id} />
      </VStack>
    </SettingsLayout>
  );
}

export default withPermissionGuard("sso:view", {
  layoutComponent: SettingsLayout,
  bypassOnboardingRedirect: true,
})(SingleSignOnSettings);
