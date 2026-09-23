/**
 * /settings/authentication, in the settings chrome as on main: how everyone signs in and how
 * accounts arrive (the cards sso and scim declare), then the organization's own policies.
 * Spec: specs/identity/organization-authentication-settings.feature
 */
import { Heading, SimpleGrid, Skeleton, Text, VStack } from "@chakra-ui/react";
import { Suspense } from "react";

import {
  AUTHENTICATION_PAGE_PERMISSION,
  useOrganizationHost,
  type OrganizationHostApi,
} from "../../../../model/organization-host.ts";
import { PermissionAlert } from "../../../../ui/elements/permission-alert.tsx";
import { OrganizationPolicyCard } from "./organization-policy-card.tsx";

export default function AuthenticationSettingsScreen() {
  const host = useOrganizationHost();
  const { organizationId } = host.scope();
  if (!organizationId) return null;
  if (!host.hasOrganizationPermission(AUTHENTICATION_PAGE_PERMISSION)) {
    return <PermissionAlert permission={AUTHENTICATION_PAGE_PERMISSION} />;
  }

  return <AuthenticationSettings host={host} organizationId={organizationId} />;
}

export function AuthenticationSettings({
  host,
  organizationId,
}: {
  host: OrganizationHostApi;
  organizationId: string;
}) {
  const canReadMembership = host.hasOrganizationPermission("organization:manage");
  const cards = host.authenticationOverviewCards();
  const organizationName = host.organization()?.name;

  return (
    <VStack align="stretch" gap={5} width="full">
      <VStack align="start" gap={1}>
        <Heading as="h2">Authentication</Heading>
        <Text color="fg.muted">
          {organizationName
            ? `Manage sign-in, provisioning, and security policies for ${organizationName}.`
            : "Manage sign-in, provisioning, and security policies for your organization."}
        </Text>
      </VStack>

      {cards.length > 0 && (
        <VStack align="stretch" gap={4} width="full">
          <VStack align="stretch" gap={1}>
            <Heading size="sm">Sign-in and provisioning</Heading>
            <Text color="fg.muted" fontSize="sm">
              Connect your identity provider for single sign-on and directory sync.
            </Text>
          </VStack>
          <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} width="full">
            {cards.map(({ key, Card }) => (
              <Suspense key={key} fallback={<Skeleton height="220px" width="full" />}>
                <Card organizationId={organizationId} canReadMembership={canReadMembership} />
              </Suspense>
            ))}
          </SimpleGrid>
        </VStack>
      )}

      <VStack align="stretch" gap={4} paddingTop={2}>
        <VStack align="stretch" gap={1}>
          <Heading size="sm">Organization policies</Heading>
          <Text color="fg.muted" fontSize="sm">
            Manage who can join and how accounts stay secure. These policies also apply when your
            organization uses password sign-in.
          </Text>
        </VStack>
        <OrganizationPolicyCard
          host={host}
          organizationId={organizationId}
          canManage={canReadMembership}
        />
      </VStack>
    </VStack>
  );
}
