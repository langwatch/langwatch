import { Heading, Spinner, Text, VStack } from "@chakra-ui/react";
import { orgRoleOptions } from "~/components/settings/OrganizationUserRoleField";
import type { OrganizationUserRole } from "~/generated/prisma/client";
import { api } from "~/utils/api";
import { SectionErrorNotice } from "../settings/SectionErrorNotice";
import { IdentityChip, IdentityRow, IdentityRowList } from "./IdentityRow";
import { ProvenanceChip } from "./ProvenanceChip";

/**
 * The people the directory actually put here, named.
 *
 * The status band above counts them — "People it manages: 12" — and a count is
 * the one answer nobody can check. An administrator asking whether the sync is
 * right is asking about a PERSON: did Sam come through Okta, is Ana still
 * managed, why is this contractor here. A number cannot be wrong in a way you
 * can see, and a list can.
 *
 * ONLY THE PEOPLE THE DIRECTORY MANAGES. The members page lists everybody and
 * is where somebody is invited, deactivated or given a role; this is the same
 * roster narrowed to the directory's own work, on the page about the
 * directory. Repeating the whole organization here would be a second members
 * page that drifts from the first.
 *
 * REAL COLUMNS ONLY. A person, the access they hold, where they came from, and
 * whether their access is currently on. Departments, several sources at once
 * and the directory identities that matched nobody are things this
 * organization's data does not hold, so there is no column for them — an empty
 * frame is a promise the product has not made.
 *
 * TWO READS, JOINED HERE. The roster carries the names and the roles; the
 * provenance carries which of them the directory created. Both are
 * `organization:manage`, which is the same authority the band's own membership
 * facts need, so the page hands down the one answer rather than each component
 * asking again.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
export function DirectoryMembersSection({
  organizationId,
}: {
  organizationId: string;
}) {
  const organization =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery({
      organizationId,
      // Somebody the directory still manages whose access has been switched
      // off is exactly the row worth seeing: leaving them out would make the
      // list quietly disagree with the count above it.
      includeDeactivated: true,
    });
  const provenance = api.organization.getMemberProvenance.useQuery({
    organizationId,
  });

  const members = organization.data?.members ?? [];
  const managed = members.filter(
    (member) => provenance.data?.[member.userId]?.source === "directory",
  );

  return (
    <VStack gap={2} align="start" width="full">
      <Heading size="sm">People your directory manages</Heading>
      <Text color="fg.muted" fontSize="sm">
        Your identity provider created these accounts and decides whether they
        stay.
      </Text>

      {/* Either read failing takes the list away, because a list drawn from
          half of it would be a WRONG list rather than a short one: without
          provenance every member looks unmanaged, and without the roster the
          managed ones have no names. */}
      <SectionErrorNotice
        error={organization.error ?? provenance.error}
        fallbackTitle="Couldn't read the people your directory manages"
      />

      {organization.isLoading || provenance.isLoading ? (
        <Spinner size="sm" />
      ) : (
        <IdentityRowList
          data-testid="directory-managed-members"
          empty={emptyWord({ memberCount: members.length })}
        >
          {managed.map((member) => (
            <IdentityRow
              key={member.userId}
              id={member.userId}
              name={member.user.name}
              address={member.user.email}
              image={member.user.image}
              muted={!!member.disabledAt || !!member.user.deactivatedAt}
              chips={
                <>
                  <IdentityChip label={orgRoleLabel(member.role)} />
                  <ProvenanceChip
                    provenance={provenance.data?.[member.userId]}
                  />
                  <AccessStateChip
                    disabledAt={member.disabledAt}
                    deactivatedAt={member.user.deactivatedAt}
                  />
                </>
              }
              data-testid="directory-managed-member"
            />
          ))}
        </IdentityRowList>
      )}
    </VStack>
  );
}

/**
 * Whether this person's access is on, and only where it is not.
 *
 * An "Active" chip on every row is a column of the same word repeated, which
 * teaches the eye to skip the place the exceptions appear. The two states
 * worth marking are the two that mean somebody managed by the directory
 * cannot currently get in.
 */
function AccessStateChip({
  disabledAt,
  deactivatedAt,
}: {
  disabledAt: Date | null;
  deactivatedAt: Date | null;
}) {
  if (deactivatedAt) {
    return (
      <IdentityChip
        label="Deactivated"
        tone="warning"
        title="This account has been deactivated here. Your identity provider may still list them."
        data-testid="member-deactivated"
      />
    );
  }
  if (disabledAt) {
    return (
      <IdentityChip
        label="Disabled"
        tone="warning"
        title="Their access in this organization is switched off."
        data-testid="member-disabled"
      />
    );
  }
  return null;
}

/**
 * The empty list, in the words that fit the reason it is empty.
 *
 * An organization with members but none of them provisioned is a working
 * organization whose directory has not taken over yet, and saying "nobody is
 * here" about it would be false — there are people here, they simply arrived
 * another way. The two cases get two sentences.
 */
function emptyWord({ memberCount }: { memberCount: number }): string {
  if (memberCount === 0) return "Nobody is in this organization yet.";
  return memberCount === 1
    ? "Your identity provider has not provisioned anyone yet. The one member here arrived another way."
    : `Your identity provider has not provisioned anyone yet. All ${memberCount} members here arrived another way.`;
}

/** The role, in the word the rest of the product uses for it. */
function orgRoleLabel(role: OrganizationUserRole): string {
  return orgRoleOptions.find((option) => option.value === role)?.label ?? role;
}
