// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * An update to the organization's own identity provider: who signs people in
 * now, what is left before finishing, and the two levers that move it. The
 * copy is the customer's, never the ledger's. Props-driven; the screen owns I/O.
 */
import { Badge, Button, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { HelpCircle } from "lucide-react";

import {
  checkCopyFor,
  MEMBER_MOVE,
  movedAcrossLine,
  directoryStatusLine,
  inheritedDomainLine,
  migrationLevers,
  migrationTitle,
  servingSignInNow,
  UPDATE_FINISH_CONDITIONS,
  updateChipFor,
  updateStatusLine,
  type MigrationMembersView,
  type MigrationView,
  type SsoMigrationRoute,
} from "../../model/migration-route.ts";
import { InlineRefusal } from "../elements/refusals.tsx";
import { SettingsCard } from "../elements/settings-card.tsx";

export function MigrationProgressSection({
  migration,
  canManage,
  connectionActive,
  pending = false,
  refusal,
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
  /** What the last lever was refused with, said beside the levers rather
   *  than in a toast that leaves mid-cutover. */
  refusal?: unknown;
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
  const levers = migrationLevers({ migration, connectionActive, pending });
  const routeLever = levers.route;

  return (
    <SettingsCard title={migrationTitle(migration.legacy.providerId)} testId="sso-migration">
      <HStack gap={2} justify="space-between" align="start">
        <Text fontSize="sm" data-testid="sso-update-status">
          {updateStatusLine(migration)}
        </Text>
        <UpdatePhaseChip migration={migration} />
      </HStack>
      <VStack align="stretch" gap={1}>
        <MigrationRow label="Signing people in">{servingSignInNow(migration)}</MigrationRow>
        <MigrationRow label="Members moved across">
          {movedAcrossLine(migration.members)}
        </MigrationRow>
        <MigrationRow label="Directory sync">
          {directoryStatusLine(migration.scim.status)}
        </MigrationRow>
      </VStack>
      {migration.inheritedDomains.length > 0 && (
        <Text fontSize="xs" color="fg.muted">
          {migration.inheritedDomains.map(inheritedDomainLine).join(", ")}
        </Text>
      )}
      <InlineRefusal error={refusal} what="This update" />
      <MigrationStragglers
        members={members ?? migration.members}
        unavailable={membersUnavailable}
        loading={membersLoading}
        failed={membersFailed}
        showPrevious={showPreviousMembers}
        onNextMembers={onNextMembers}
        onPreviousMembers={onPreviousMembers}
        onRetryMembers={onRetryMembers}
      />
      {migration.phase !== "FINALIZED" && (
        <VStack align="stretch" gap={1}>
          <HStack gap={1}>
            <Text fontSize="xs" fontWeight="semibold">
              Before you can finish
            </Text>
            <FinishConditionsHelp />
          </HStack>
          {migration.blockers.length === 0 ? (
            <Text fontSize="xs" color="fg.muted">
              Every check has passed.
            </Text>
          ) : (
            migration.blockers.map((blocker) => (
              <Text key={blocker.code} fontSize="xs" color="fg.muted">
                {checkCopyFor({ blocker, migration })}
              </Text>
            ))
          )}
        </VStack>
      )}
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

function UpdatePhaseChip({ migration }: { migration: MigrationView }) {
  const chip = updateChipFor(migration.phase);

  return (
    <Badge
      size="sm"
      colorPalette={chip.tone === "good" ? "green" : "yellow"}
      title={chip.title}
      data-testid="sso-update-chip"
    >
      {chip.label}
    </Badge>
  );
}

/** Every condition finishing needs, on the help beside the heading (copywriting.md). */
function FinishConditionsHelp() {
  return (
    <Tooltip
      content={
        <VStack align="stretch" gap={0.5}>
          {UPDATE_FINISH_CONDITIONS.map((condition) => (
            <Text key={condition} fontSize="xs">
              {condition}
            </Text>
          ))}
        </VStack>
      }
    >
      <IconButton
        size="2xs"
        variant="plain"
        color="fg.subtle"
        minWidth="auto"
        height="auto"
        cursor="help"
        aria-label="Everything that has to be true before you can finish"
        data-testid="sso-update-conditions-help"
      >
        <HelpCircle size={12} />
      </IconButton>
    </Tooltip>
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
  members,
  unavailable,
  loading,
  failed,
  showPrevious,
  onNextMembers,
  onPreviousMembers,
  onRetryMembers,
}: {
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
        Not moved across yet
      </Text>
      <MigrationMemberRows
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
  members,
  unavailable,
  loading,
  failed,
}: {
  members: MigrationMembersView;
  unavailable: boolean;
  loading: boolean;
  failed: boolean;
}) {
  if (failed) {
    return (
      <Text fontSize="sm" color="fg.muted">
        We could not load the members not moved across yet.
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
        This list is no longer available.
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
        <Text key={person.userId} fontSize="xs" color="fg.muted" data-testid="sso-update-member">
          <Text as="span" color="fg">
            {person.name ?? person.email ?? person.userId}
          </Text>
          {` · ${MEMBER_MOVE[person.move]}`}
        </Text>
      ))}
    </>
  );
}
