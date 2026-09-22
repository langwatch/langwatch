// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A cutover in progress: who is serving sign-in now, how far the members have
 * come, what is still in the way, and the two levers that move it — swap the
 * route, or finalize. Props-driven; the screen owns the reads and the writes.
 */
import { Button, HStack, Text, VStack } from "@chakra-ui/react";

import {
  inheritedDomainLine,
  migrationLevers,
  migrationTitle,
  previousProviderName,
  servingSignInNow,
  type MigrationMembersView,
  type MigrationView,
  type SsoMigrationRoute,
} from "../../model/migration-route.ts";
import { SettingsCard } from "../elements/settings-card.tsx";

export function MigrationProgressSection({
  migration,
  canManage,
  connectionActive,
  pending = false,
  members,
  membersLoading = false,
  membersFailed = false,
  membersUnavailable = false,
  showPreviousMembers = false,
  onSelectRoute,
  onFinalize,
  onNextMembers,
  onPreviousMembers,
  onRetryMembers,
}: {
  migration: MigrationView;
  canManage: boolean;
  /** Both levers decide where sign-in goes, so neither moves while it is off. */
  connectionActive: boolean;
  pending?: boolean;
  /** The page being shown; the view's own first page when none is given. */
  members?: MigrationMembersView;
  membersLoading?: boolean;
  membersFailed?: boolean;
  /** A later page the read no longer answers at all. */
  membersUnavailable?: boolean;
  showPreviousMembers?: boolean;
  onSelectRoute: (route: SsoMigrationRoute) => void;
  onFinalize: () => void;
  onNextMembers?: (cursor: string) => void;
  onPreviousMembers?: () => void;
  onRetryMembers?: () => void;
}) {
  const previous = previousProviderName(migration.legacy.providerId);
  const levers = migrationLevers({ migration, connectionActive, pending });
  const routeLever = levers.route;

  return (
    <SettingsCard title={migrationTitle(migration.legacy.providerId)} testId="sso-migration">
      <VStack align="stretch" gap={1}>
        <MigrationRow label="Normal sign-in">{servingSignInNow(migration)}</MigrationRow>
        <MigrationRow label="Members linked">
          {`${migration.members.linkedCount} of ${migration.members.activeCount}`}
        </MigrationRow>
        <MigrationRow label="Directory provisioning">
          {migration.scim.status.replaceAll("-", " ")}
        </MigrationRow>
      </VStack>
      {migration.inheritedDomains.length > 0 && (
        <Text fontSize="xs" color="fg.muted">
          {migration.inheritedDomains.map(inheritedDomainLine).join(", ")}
        </Text>
      )}
      <MigrationStragglers
        previous={previous}
        members={members ?? migration.members}
        unavailable={membersUnavailable}
        loading={membersLoading}
        failed={membersFailed}
        showPrevious={showPreviousMembers}
        onNextMembers={onNextMembers}
        onPreviousMembers={onPreviousMembers}
        onRetryMembers={onRetryMembers}
      />
      {migration.blockers.map((blocker) => (
        <Text key={blocker.code} fontSize="xs" color="fg.muted">
          {blocker.message}
        </Text>
      ))}
      {canManage && migration.phase !== "FINALIZED" && (
        <HStack gap={2} flexWrap="wrap">
          {routeLever && (
            <Button
              size="sm"
              variant={routeLever.to === "direct" ? "solid" : "outline"}
              disabled={routeLever.disabled}
              data-testid="sso-migration-route"
              onClick={() => onSelectRoute(routeLever.to)}
            >
              {routeLever.label}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={levers.finalize.disabled}
            data-testid="sso-migration-finalize"
            onClick={onFinalize}
          >
            {levers.finalize.label}
          </Button>
        </HStack>
      )}
    </SettingsCard>
  );
}

function MigrationRow({ label, children }: { label: string; children: string }) {
  return (
    <HStack gap={2} justify="space-between">
      <Text fontSize="sm" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="sm">{children}</Text>
    </HStack>
  );
}

/**
 * Whoever is still arriving through the old route. Absent entirely on the
 * first page when there is nobody left, because a heading saying nothing is
 * left reads as a step somebody has to take.
 */
function MigrationStragglers({
  previous,
  members,
  unavailable,
  loading,
  failed,
  showPrevious,
  onNextMembers,
  onPreviousMembers,
  onRetryMembers,
}: {
  previous: string;
  members: MigrationMembersView;
  unavailable: boolean;
  loading: boolean;
  failed: boolean;
  showPrevious: boolean;
  onNextMembers?: (cursor: string) => void;
  onPreviousMembers?: () => void;
  onRetryMembers?: () => void;
}) {
  if (!failed && !unavailable && !showPrevious && members.stragglers.length === 0) {
    return null;
  }

  const nextCursor = members.nextCursor;

  return (
    <VStack align="stretch" gap={1} data-testid="sso-migration-stragglers">
      <Text fontSize="sm" fontWeight="semibold">
        Still using {previous}
      </Text>
      <MigrationMemberRows
        previous={previous}
        members={members}
        unavailable={unavailable}
        loading={loading}
        failed={failed}
      />
      <HStack gap={2}>
        {showPrevious && onPreviousMembers && (
          <Button size="sm" variant="outline" onClick={onPreviousMembers}>
            Previous members
          </Button>
        )}
        {failed && onRetryMembers && (
          <Button size="sm" variant="outline" disabled={loading} onClick={onRetryMembers}>
            Retry members
          </Button>
        )}
        {!failed && nextCursor && onNextMembers && (
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => onNextMembers(nextCursor)}
          >
            Next members
          </Button>
        )}
      </HStack>
    </VStack>
  );
}

function MigrationMemberRows({
  previous,
  members,
  unavailable,
  loading,
  failed,
}: {
  previous: string;
  members: MigrationMembersView;
  unavailable: boolean;
  loading: boolean;
  failed: boolean;
}) {
  if (failed) {
    return (
      <Text fontSize="sm" color="fg.muted">
        We could not read who is still using {previous}.
      </Text>
    );
  }
  if (loading) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Loading members…
      </Text>
    );
  }
  if (unavailable) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Migration progress is no longer available.
      </Text>
    );
  }
  if (members.stragglers.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        No remaining members on this page.
      </Text>
    );
  }

  return (
    <>
      {members.stragglers.map((person) => (
        <Text key={person.userId} fontSize="xs" color="fg.muted">
          {person.name ?? person.email ?? person.userId}
        </Text>
      ))}
    </>
  );
}
