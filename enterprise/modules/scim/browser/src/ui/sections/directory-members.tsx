import { Link } from "@langwatch/browser-host/link";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The people the directory actually put here, named: the status band counts
 * them and a count is the one answer nobody can check. Two `organization:manage`
 * reads joined here: the roster for names, provenance for who the directory made.
 */
import { Heading, HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { StatusChip } from "@langwatch/design-system/settings-card";
import { HandledErrorAlert } from "@langwatch/error-views";

import { directoryMembershipApi } from "../../behavior/scim-api.ts";

/** How many are shown before the page hands over to the roster built for it. */
const MANAGED_SHOWN = 8;

export function DirectoryMembers({ organizationId }: { organizationId: string }) {
  const organization = directoryMembershipApi.organization.getAllOrganizationMembers.useQuery({
    organizationId,
  });
  const provenance = directoryMembershipApi.organization.getMemberProvenance.useQuery({
    organizationId,
  });

  const members = organization.data ?? [];
  const managed = members.filter((member) => provenance.data?.[member.id]?.source === "directory");
  const failure = organization.error ?? provenance.error;

  return (
    <VStack gap={2} align="start" width="full" data-testid="directory-members">
      <Heading size="sm">People your directory manages</Heading>
      <Text color="fg.muted" fontSize="sm">
        Your identity provider created these accounts and decides whether they stay.
      </Text>

      {failure && (
        <HandledErrorAlert
          error={failure}
          fallbackTitle="Couldn't read the people your directory manages"
          onRetry={() => {
            void organization.refetch();
            void provenance.refetch();
          }}
        />
      )}

      {organization.isLoading || provenance.isLoading ? (
        <Spinner size="sm" />
      ) : (
        !failure && (
          <VStack align="stretch" gap={0} width="full" data-testid="directory-managed-members">
            {managed.length === 0 && (
              <Text color="fg.muted" fontSize="sm" data-testid="directory-managed-empty">
                {emptyWord({ memberCount: members.length })}
              </Text>
            )}
            {managed.slice(0, MANAGED_SHOWN).map((member) => (
              <HStack
                key={member.id}
                gap={3}
                paddingY={2}
                borderBottomWidth="1px"
                borderColor="border.muted"
                opacity={member.deactivatedAt ? 0.6 : 1}
                data-testid="directory-managed-member"
              >
                <VStack align="start" gap={0} flex="1" minWidth={0}>
                  <Text fontSize="sm" fontWeight="500">
                    {member.name ?? member.email}
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    {member.email}
                  </Text>
                </VStack>
                <StatusChip
                  label="Directory"
                  title="Created by your identity provider, which decides whether this person stays."
                  data-testid="provenance-directory"
                />
                {member.deactivatedAt && (
                  <StatusChip
                    label="Deactivated"
                    tone="warning"
                    title="This account has been deactivated here. Your identity provider may still list them."
                    data-testid="member-deactivated"
                  />
                )}
              </HStack>
            ))}
          </VStack>
        )
      )}

      {managed.length > MANAGED_SHOWN && (
        <Text fontSize="sm" color="fg.muted" data-testid="directory-managed-more">
          Showing {MANAGED_SHOWN} of {managed.length}.{" "}
          <Link href="/settings/directory">See everyone in your directory</Link>.
        </Text>
      )}
    </VStack>
  );
}

/** An organization with members but none provisioned has not been taken over yet, not emptied. */
function emptyWord({ memberCount }: { memberCount: number }): string {
  if (memberCount === 0) return "Nobody is in this organization yet.";
  return memberCount === 1
    ? "Your identity provider has not provisioned anyone yet. The one member here arrived another way."
    : `Your identity provider has not provisioned anyone yet. All ${memberCount} members here arrived another way.`;
}
