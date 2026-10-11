import { PageLayout, type PageTab } from "@langwatch/design-system/page-layout";
/**
 * /settings/authentication, in the settings chrome as on main: how everyone signs in and how
 * accounts arrive (the cards sso and scim declare), then the organization's own policies.
 * Spec: specs/identity/organization-authentication-settings.feature
 */
import {
  Box,
  Heading,
  SimpleGrid,
  Skeleton,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Suspense } from "react";

import {
  AUTHENTICATION_PAGE_PERMISSION,
  useOrganizationHost,
  type OrganizationHostApi,
} from "../../../../model/organization-host.ts";
import { PermissionAlert } from "../../../../ui/elements/permission-alert.tsx";
import { OrganizationPolicyCard } from "./organization-policy-card.tsx";

/** The three Authentication pages, as header tabs (ARCHITECTURE.md §10). */
const AUTHENTICATION_TABS: readonly PageTab[] = [
  { label: "Overview", href: "/settings/authentication" },
  { label: "Identity provider", href: "/settings/authentication/provider" },
  { label: "Connectors", href: "/settings/authentication/connectors" },
];

export default function AuthenticationSettingsScreen() {
  const host = useOrganizationHost();
  const { organizationId } = host.scope();
  if (!organizationId) return null;
  if (!host.hasOrganizationPermission(AUTHENTICATION_PAGE_PERMISSION)) {
    return (
      <PermissionAlert permission={AUTHENTICATION_PAGE_PERMISSION} area="authentication settings" />
    );
  }

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Authentication</PageLayout.Heading>
        <PageLayout.Tabs
          label="Authentication pages"
          tabs={AUTHENTICATION_TABS}
          activeHref="/settings/authentication"
          onNavigate={(href) => host.navigate(href)}
        />
      </PageLayout.Header>
      <Box paddingTop={4}>
        <AuthenticationSettings host={host} organizationId={organizationId} />
      </Box>
    </>
  );
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
    <VStack align="stretch" gap={6} width="full" paddingTop={4}>
      <Text color="fg.muted">
        {organizationName
          ? `Manage sign-in, provisioning, and security policies for ${organizationName}.`
          : "Manage sign-in, provisioning, and security policies for your organization."}
      </Text>

      {cards.length > 0 && (
        <VStack align="stretch" gap={4} width="full">
          <VStack align="stretch" gap={1}>
            <Heading textStyle="cardTitle">Sign-in and provisioning</Heading>
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

      <VStack align="stretch" gap={4} width="full" paddingTop={2}>
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
