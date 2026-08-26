import { VStack } from "@chakra-ui/react";
import { AuthenticationLayout } from "../../../components/settings/authentication/AuthenticationLayout";
import {
  ConnectorsOverview,
  TokensSection,
} from "../../../components/settings/authentication/ConnectorsSection";
import { SettingsPageHeader } from "../../../components/settings/SettingsPageHeader";
import SettingsLayout from "../../../components/SettingsLayout";
import { PermissionAlert } from "../../../components/PermissionAlert";
import { withPermissionGuard } from "../../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";

/**
 * The connectors that create and remove people here on their own (D08,
 * ADR-122).
 *
 * ONE PROVIDER, MANY CONNECTORS. An organization federates sign-in through a
 * single identity provider and can be provisioned from more than one place,
 * which is why this is its own destination rather than the other half of the
 * provider's page: what is on it is a LIST, and the thing beside it is not.
 *
 * IT WAS A TAB OF THE DIRECTORY, and the Directory is about who is here.
 * Whether a connector is syncing, what it could not apply, where to point it
 * and what credential to point it with are all about how people ARRIVE, which
 * is this section's subject. The Directory still answers who arrived; its old
 * provisioning address forwards here.
 *
 * `sso:view` reads it — a security reviewer's job — and `sso:manage` is what
 * issues and revokes a token. A reader without the second is offered no
 * control at all: a disabled button is still an invitation, and inviting
 * somebody to do a thing they will be refused for is worse than not offering
 * it.
 */
function ConnectorsPage() {
  const { organization, hasPermission } = useOrganizationTeamProject();
  const maySeeSync = hasPermission("sso:view");
  const mayManageTokens = hasPermission("sso:manage");
  const mayReadMembership = hasPermission("organization:manage");

  if (!organization) return <SettingsLayout />;

  return (
    <AuthenticationLayout>
      <VStack align="stretch" gap={6} width="full">
        <SettingsPageHeader
          title="Connectors"
          description="Your identity provider creates, updates and removes people here on its own, over SCIM."
        />
        {maySeeSync ? (
          <>
            <ConnectorsOverview
              organizationId={organization.id}
              mayReadMembership={mayReadMembership}
              maySetUpSingleSignOn={mayManageTokens}
            />
            <TokensSection
              organizationId={organization.id}
              mayManage={mayManageTokens}
            />
          </>
        ) : (
          <PermissionAlert permission="sso:view" />
        )}
      </VStack>
    </AuthenticationLayout>
  );
}

export default withPermissionGuard("sso:view", {
  layoutComponent: SettingsLayout,
  bypassOnboardingRedirect: true,
})(ConnectorsPage);
