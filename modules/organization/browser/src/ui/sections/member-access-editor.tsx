/** What one member can reach, and the one save that changes it. */

import { GrantScopeTier } from "@langwatch/authz-contract";
import { Link } from "@langwatch/browser-host/link";
import { Banner, BannerAction } from "@langwatch/design-system/banner";
import {
  Badge,
  Box,
  Button,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { SettingsSectionRow } from "@langwatch/design-system/settings-section";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { HandledErrorAlert } from "../../behavior/handled-error-form.tsx";
import { SeatRoleOffer } from "../../behavior/lent-seat-role-offer.tsx";
import {
  api,
  type OrganizationApiMap,
  type RouterOutputs,
} from "../../behavior/organization-api.ts";
import { useOrganizationToaster, useShowErrorToast } from "../../behavior/organization-feedback.ts";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project.ts";
import {
  type SeatRoleChanged,
  useSeatRoleChange,
  withArticle,
} from "../../behavior/use-seat-role-change.ts";
import { directoryOwnershipCopy } from "../../model/group-source.ts";
import { BILLING_ONLY_SEAT, type InviteSeat } from "../../model/member-invite-form.ts";
import { OrganizationUserRole, TeamUserRole } from "../../model/prisma-types.ts";
import { IdentityChip } from "../elements/identity-row.tsx";
import {
  OrganizationUserRoleField,
  orgRoleOptions,
  seatLabel,
} from "../elements/organization-user-role-field.tsx";
import {
  GrantInputRow,
  type GrantInputRowHandle,
  type PendingGrant,
  toggled,
} from "./group-grant-input-row.tsx";

type MemberGroup = OrganizationApiMap["group"]["listForMember"]["query"]["output"][number];

/** Team names as a reader would say them: "A", "A and B", "A, B and C". */
function listTeamNames(names: string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  if (quoted.length <= 1) return quoted[0] ?? "";
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

/** What makes two access rows the same grant, regardless of which row it is. */
function grantKey(grant: {
  role: string;
  customRoleId?: string | null;
  scopeType: GrantScopeTier;
  scopeId: string;
}): string {
  return `${grant.role}:${grant.customRoleId ?? ""}:${grant.scopeType}:${grant.scopeId}`;
}

/** "Organization", "Team Platform", "Project Checkout"; an unresolved name says its kind. */
function scopeLabel({
  scopeType,
  scopeName,
}: {
  scopeType: GrantScopeTier;
  scopeName?: string | null;
}): string {
  if (scopeType === GrantScopeTier.ORGANIZATION) return "Organization";
  const kind = scopeType === GrantScopeTier.TEAM ? "Team" : "Project";
  return scopeName ? `${kind} ${scopeName}` : kind;
}

/** Colour by how much the role can do, not by which one it happens to be. */
function roleTone(role: string): string {
  if (role === "ADMIN") return "red";
  if (role === "MEMBER") return "accent";
  if (role === "VIEWER") return "gray";
  return "purple";
}

/** A Lite Member seat allows Viewer only, so a staged row above it snaps down. */
function constrainToSeat({
  grant,
  organizationRole,
}: {
  grant: PendingGrant;
  organizationRole: OrganizationUserRole;
}): PendingGrant {
  if (organizationRole !== OrganizationUserRole.EXTERNAL) return grant;
  if (!grant.customRoleId && grant.role === TeamUserRole.VIEWER) return grant;
  return {
    ...grant,
    role: TeamUserRole.VIEWER,
    roleValue: TeamUserRole.VIEWER,
    customRoleId: undefined,
    customRoleName: undefined,
  };
}

/** A staged row the member already holds, or the same row staged twice, adds nothing. */
function newGrantAdditions({
  staged,
  held,
  removals,
}: {
  staged: PendingGrant[];
  held: readonly (Parameters<typeof grantKey>[0] & { id: string })[];
  removals: ReadonlySet<string>;
}): PendingGrant[] {
  const heldKeys = new Set(held.filter((row) => !removals.has(row.id)).map(grantKey));
  return staged.filter((grant) => {
    const key = grantKey(grant);
    if (heldKeys.has(key)) return false;
    heldKeys.add(key);
    return true;
  });
}

/** Staged once: the same grant staged again changes nothing. */
function withStaged({
  staged,
  grant,
}: {
  staged: PendingGrant[];
  grant: PendingGrant;
}): PendingGrant[] {
  const key = grantKey(grant);
  return staged.some((row) => grantKey(row) === key) ? staged : [...staged, grant];
}

/** A Lite Member seat drops organization rows, snaps the rest to Viewer, collapses duplicates. */
function stagedRowsForLiteSeat(staged: PendingGrant[]): PendingGrant[] {
  return staged
    .filter((grant) => grant.scopeType !== GrantScopeTier.ORGANIZATION)
    .map((grant) => constrainToSeat({ grant, organizationRole: OrganizationUserRole.EXTERNAL }))
    .reduce<PendingGrant[]>((kept, grant) => withStaged({ staged: kept, grant }), []);
}

/** The organization row mirroring the seat belongs to the seat selector, not to this list. */
function mirrorsSeat({
  grant,
  seat,
}: {
  grant: { role: string; customRoleId?: string | null; scopeType: GrantScopeTier };
  seat: OrganizationUserRole;
}): boolean {
  return (
    grant.scopeType === GrantScopeTier.ORGANIZATION && !grant.customRoleId && grant.role === seat
  );
}

/** A seat correction may take away a team's only team admin; this is where the admin finds out. */
function teamsLeftWithoutAdminLine(teams: { name: string }[]): string | undefined {
  if (teams.length === 0) return undefined;
  const one = teams.length === 1;
  return `${listTeamNames(teams.map((team) => team.name))} no longer ${one ? "has" : "have"} a team admin. Organization admins can still manage ${one ? "it" : "them"}.`;
}

/** A group grant above Viewer applies as Viewer while the member holds a Lite Member seat. */
function appliesAsViewer({
  role,
  organizationRole,
}: {
  role: string;
  organizationRole: OrganizationUserRole;
}): boolean {
  return (
    organizationRole === OrganizationUserRole.EXTERNAL &&
    role !== TeamUserRole.VIEWER &&
    role !== TeamUserRole.CUSTOM
  );
}

export function MemberAccessEditor({
  organizationId,
  userId,
  memberRole,
  memberBillingOnly = false,
  canManage,
  isCurrentUser,
}: {
  organizationId: string;
  userId: string;
  memberRole: OrganizationUserRole;
  /** Billing only (ADR-205): shown as its own seat; moving to any role ends it. */
  memberBillingOnly?: boolean;
  canManage: boolean;
  isCurrentUser: boolean;
}) {
  const { organization } = useOrganizationTeamProject();
  const editor = useMemberAccessEditor({
    organizationId,
    userId,
    memberRole,
    memberBillingOnly,
    canManage,
    canChangeRole: canManage && !isCurrentUser,
  });

  return (
    <VStack gap={5} align="stretch" width="full">
      {canManage && (
        <Box>
          <Text fontSize="sm" fontWeight="semibold" mb={3}>
            Organization role
          </Text>
          {isCurrentUser ? (
            <Text fontSize="sm" color="fg.muted">
              You cannot change your own organization role.
            </Text>
          ) : (
            <OrganizationUserRoleField<InviteSeat>
              value={editor.pendingSeat}
              onChange={editor.pickSeat}
              disabled={editor.seatChangeInFlight}
              roles={seatsOffered({ memberBillingOnly })}
            />
          )}
          {editor.showSeatPanel && (
            <Box marginTop={3}>
              <SeatRolePanel
                organizationId={organizationId}
                organizationName={organization?.name ?? "Your organization"}
                editor={editor}
              />
            </Box>
          )}
        </Box>
      )}

      {canManage && (
        <Box>
          <Text fontSize="sm" fontWeight="semibold" mb={3}>
            Role assignments
          </Text>
          <DirectAssignments
            directGrants={editor.directGrants}
            staged={editor.pendingGrantAdditions}
            removals={editor.pendingGrantRemovals}
            seat={memberRole}
            locked={editor.seatChangeInFlight}
            onToggle={(id) => editor.setPendingGrantRemovals((prev) => toggled({ set: prev, id }))}
            onUndo={(index) =>
              editor.setPendingGrantAdditions((prev) => prev.filter((_, j) => j !== index))
            }
          />
          <NoAccessNote seat={editor.pendingSeat}>
            <GrantInputRow
              ref={editor.grantInputRef}
              organizationId={organizationId}
              onAdd={editor.stageAddition}
              onReadyChange={editor.setHasDraftGrant}
              organizationRole={editor.pendingRole}
              buttonLabel="Assign role"
              disabled={editor.seatChangeInFlight}
            />
          </NoAccessNote>
        </Box>
      )}

      <Box>
        <Text fontSize="sm" fontWeight="semibold" mb={3}>
          Groups
        </Text>
        <MemberGroups memberGroups={editor.memberGroups} pendingRole={editor.pendingRole} />
      </Box>

      {canManage && (
        <HStack justifyContent="flex-end" gap={2}>
          <Button
            variant="outline"
            disabled={!editor.hasChanges || editor.seatChangeInFlight}
            onClick={editor.reset}
          >
            Cancel
          </Button>
          {editor.seatPurchaseOffered ? null : (
            <Button
              colorPalette="accent"
              disabled={!editor.hasChanges || editor.isSaving}
              loading={editor.isSaving}
              onClick={() => void editor.handleSave()}
            >
              Save
            </Button>
          )}
        </HStack>
      )}
    </VStack>
  );
}

type QueryReading<T> = {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
};

function AssignmentBadges({
  role,
  customRoleName,
  scopeType,
  scopeName,
  struck = false,
}: {
  role: string;
  customRoleName?: string | null;
  scopeType: GrantScopeTier;
  scopeName?: string | null;
  struck?: boolean;
}) {
  const textDecoration = struck ? "line-through" : undefined;
  return (
    <>
      <Badge colorPalette={roleTone(role)} size="sm" textDecoration={textDecoration}>
        {customRoleName ?? role}
      </Badge>
      <Text color="fg.muted">on</Text>
      <Badge colorPalette="purple" size="sm" variant="surface" textDecoration={textDecoration}>
        {scopeLabel({ scopeType, scopeName })}
      </Badge>
    </>
  );
}

/** Held rows strike through until Save, so Cancel never restores a row the admin forgot about. */
function DirectAssignments({
  directGrants,
  staged,
  removals,
  seat,
  locked,
  onToggle,
  onUndo,
}: {
  directGrants: QueryReading<RouterOutputs["authz"]["listMemberGrants"]>;
  staged: PendingGrant[];
  removals: ReadonlySet<string>;
  seat: OrganizationUserRole;
  /** A paid seat change in flight saves these rows as they stand. */
  locked: boolean;
  onToggle: (grantId: string) => void;
  onUndo: (index: number) => void;
}) {
  if (directGrants.isError) {
    return (
      <HandledErrorAlert
        error={directGrants.error}
        fallbackTitle="Couldn't read their role assignments"
      />
    );
  }
  if (directGrants.isLoading) return <SkeletonRows rows={2} />;
  const held = directGrants.data ?? [];
  if (held.length === 0 && staged.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        No role assigned.
      </Text>
    );
  }
  return (
    <VStack gap={2} align="stretch">
      {held.map((b) => {
        const marked = removals.has(b.id);
        const removable =
          b.scopeType !== GrantScopeTier.PROJECT && !mirrorsSeat({ grant: b, seat });
        return (
          <HStack
            key={b.id}
            px={4}
            py={3}
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="lg"
            fontSize="sm"
            opacity={marked ? 0.4 : 1}
            transition="opacity 0.15s"
          >
            <AssignmentBadges {...b} struck={marked} />
            <Spacer />
            {removable && (
              <Button
                size="xs"
                variant="ghost"
                color={marked ? "accent.fg" : "fg.muted"}
                aria-label={marked ? "Undo removal" : "Remove assignment"}
                disabled={locked}
                onClick={() => onToggle(b.id)}
              >
                <X size={14} />
              </Button>
            )}
          </HStack>
        );
      })}
      {staged.map((b, i) => (
        <HStack
          key={grantKey(b)}
          px={4}
          py={3}
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="lg"
          fontSize="sm"
          opacity={0.7}
        >
          <AssignmentBadges {...b} />
          <Spacer />
          <Button
            size="xs"
            variant="ghost"
            color="fg.muted"
            aria-label="Undo add"
            disabled={locked}
            onClick={() => onUndo(i)}
          >
            <X size={14} />
          </Button>
        </HStack>
      ))}
    </VStack>
  );
}

/** Read-only: the group decides membership, so this says which groups and where to go. */
function MemberGroups({
  memberGroups,
  pendingRole,
}: {
  memberGroups: QueryReading<MemberGroup[]>;
  pendingRole: OrganizationUserRole;
}) {
  if (memberGroups.isError) {
    return (
      <HandledErrorAlert error={memberGroups.error} fallbackTitle="Couldn't read their groups" />
    );
  }
  if (memberGroups.isLoading) return <SkeletonRows rows={2} />;
  if (!memberGroups.data?.length) {
    return (
      <Text fontSize="sm" color="fg.muted">
        They are in no group.
      </Text>
    );
  }
  return (
    <VStack gap={2} align="stretch">
      {memberGroups.data.map((group) =>
        group.grants.length === 0 ? (
          <SettingsSectionRow key={group.id}>
            <HStack gap={2}>
              <Text fontSize="sm" color="fg.muted">
                {group.name}
              </Text>
              {group.scimSource ? (
                <IdentityChip
                  label="Directory"
                  title={directoryOwnershipCopy({ source: group.scimSource })}
                />
              ) : null}
            </HStack>
            <Spacer />
            <Link href="/settings/directory?tab=groups" fontSize="xs" color="accent.fg">
              No role assigned
            </Link>
          </SettingsSectionRow>
        ) : (
          group.grants.map((b) => (
            <SettingsSectionRow key={b.id}>
              <AssignmentBadges {...b} />
              {appliesAsViewer({ role: b.role, organizationRole: pendingRole }) && (
                <Text fontSize="xs" color="fg.muted">
                  Applies as Viewer while on a Lite Member seat
                </Text>
              )}
              <Spacer />
              <Text fontSize="xs" color="fg.muted">
                through {group.name}
              </Text>
            </SettingsSectionRow>
          ))
        ),
      )}
    </VStack>
  );
}

/**
 * Staged edits, the seat constraint and the save. The role goes first (licence and plan checks),
 * then the assignments as one batch; a failure between the two re-reads the staged view.
 */
/** Billing only and a Developer seat (ADR-171) take no shared access: a note replaces the row. */
function NoAccessNote({ seat, children }: { seat: InviteSeat; children: ReactNode }) {
  if (seat === BILLING_ONLY_SEAT) {
    return (
      <Text fontSize="xs" color="fg.muted" data-testid="billing-only-no-access">
        Billing only covers the plan and invoices. Move them to a seat to give them access to a team
        or project.
      </Text>
    );
  }
  if (seat === OrganizationUserRole.DEVELOPER) {
    return (
      <Text fontSize="xs" color="fg.muted" data-testid="developer-no-access">
        A Developer seat works in its own project only. Move them to a Member seat to give them
        access to a team or project.
      </Text>
    );
  }
  return children;
}

/** The seats the picker offers: Billing only only to show a member who already holds it. */
function seatsOffered({ memberBillingOnly }: { memberBillingOnly: boolean }): InviteSeat[] {
  return orgRoleOptions
    .map((option) => option.value)
    .filter((seat) => memberBillingOnly || seat !== BILLING_ONLY_SEAT);
}

/**
 * After a paid role change: the staged rows go as one batch (a refused role keeps them unsaved,
 * since they were staged against the new role), then what it touched is read back. Save stays
 * busy throughout.
 */
async function saveAfterPaidRole({
  roleChanged,
  setIsSaving,
  applyStagedGrants,
  refresh,
  onBatchFailed,
}: {
  roleChanged: boolean;
  setIsSaving: (saving: boolean) => void;
  applyStagedGrants: () => Promise<void>;
  refresh: () => Promise<unknown>;
  onBatchFailed: (error: unknown) => void;
}): Promise<void> {
  setIsSaving(true);
  try {
    if (roleChanged) await applyStagedGrants().catch(onBatchFailed);
    await refresh();
  } finally {
    setIsSaving(false);
  }
}

/**
 * One staged batch: a sent batch leaves the staging, a failed one stages its flushed draft again
 * for the retry. Only the member still open has its staging changed.
 */
async function sendStagedBatch({
  send,
  stillOpen,
  uncommitted,
  removed,
  added,
  setPendingGrantRemovals,
  setPendingGrantAdditions,
}: {
  send: () => Promise<unknown>;
  stillOpen: () => boolean;
  uncommitted: PendingGrant | null;
  removed: Set<string>;
  added: PendingGrant[];
  setPendingGrantRemovals: (update: (staged: Set<string>) => Set<string>) => void;
  setPendingGrantAdditions: (update: (staged: PendingGrant[]) => PendingGrant[]) => void;
}): Promise<void> {
  try {
    await send();
  } catch (error) {
    if (uncommitted && stillOpen()) {
      setPendingGrantAdditions((prev) => withStaged({ staged: prev, grant: uncommitted }));
    }
    throw error;
  }
  if (!stillOpen()) return;
  setPendingGrantRemovals((prev) => new Set([...prev].filter((id) => !removed.has(id))));
  setPendingGrantAdditions((prev) => prev.filter((grant) => !added.includes(grant)));
}

/** The staged rows follow the picked seat. */
function useStagedFollowsSeat({
  pendingSeat,
  setPendingGrantAdditions,
  setHasDraftGrant,
}: {
  pendingSeat: InviteSeat;
  setPendingGrantAdditions: (update: (staged: PendingGrant[]) => PendingGrant[]) => void;
  setHasDraftGrant: (hasDraft: boolean) => void;
}) {
  useEffect(() => {
    // Developer (ADR-171) and Billing only (ADR-205) hold nothing shared: every
    // staged row and draft goes, the way the save deletes every stored one.
    if (pendingSeat === OrganizationUserRole.DEVELOPER || pendingSeat === BILLING_ONLY_SEAT) {
      setPendingGrantAdditions(() => []);
      setHasDraftGrant(false);
      return;
    }
    if (pendingSeat !== OrganizationUserRole.EXTERNAL) return;
    setPendingGrantAdditions(stagedRowsForLiteSeat);
  }, [pendingSeat, setPendingGrantAdditions, setHasDraftGrant]);
}

/** One staged row as the access batch creates it. */
function bindingToCreate(b: PendingGrant) {
  return { role: b.role, customRoleId: b.customRoleId, scopeType: b.scopeType, scopeId: b.scopeId };
}

/**
 * Staged rows belong to the member they were staged for, never the next one opened. The ref it
 * returns is set when a paid role change landed but its access batch failed: the refreshed role
 * then keeps the staged rows, so Save retries them.
 */
function useResetStaged({
  organizationId,
  userId,
  memberSeat,
  reset,
  setPendingSeat,
}: {
  organizationId: string;
  userId: string;
  memberSeat: InviteSeat;
  reset: () => void;
  setPendingSeat: (seat: InviteSeat) => void;
}) {
  const keepStagedOnRoleRefresh = useRef(false);
  const member = memberKey({ organizationId, userId });
  const stagedFor = useRef(member);
  const latestReset = useRef(reset);
  useEffect(() => {
    latestReset.current = reset;
  });
  useEffect(() => {
    const sameMember = stagedFor.current === member;
    stagedFor.current = member;
    const keep = sameMember && keepStagedOnRoleRefresh.current;
    keepStagedOnRoleRefresh.current = false;
    if (keep) setPendingSeat(memberSeat);
    else latestReset.current();
  }, [member, memberSeat, setPendingSeat]);
  return keepStagedOnRoleRefresh;
}

/** One member in one organization: staging and late answers belong to this pair only. */
function memberKey({ organizationId, userId }: { organizationId: string; userId: string }): string {
  return `${organizationId}:${userId}`;
}

function useMemberAccessEditor({
  organizationId,
  userId,
  memberRole,
  memberBillingOnly,
  canManage,
  canChangeRole,
}: {
  organizationId: string;
  userId: string;
  memberRole: OrganizationUserRole;
  memberBillingOnly: boolean;
  canManage: boolean;
  canChangeRole: boolean;
}) {
  const toaster = useOrganizationToaster();
  const showErrorToast = useShowErrorToast();
  const queryClient = api.useUtils();

  const memberSeat: InviteSeat = memberBillingOnly ? BILLING_ONLY_SEAT : memberRole;
  const [pendingSeat, setPendingSeat] = useState<InviteSeat>(memberSeat);
  // Billing only is stored as EXTERNAL; saving any other seat clears the flag (ADR-205).
  const pendingRole: OrganizationUserRole =
    pendingSeat === BILLING_ONLY_SEAT ? OrganizationUserRole.EXTERNAL : pendingSeat;
  const [pendingGrantRemovals, setPendingGrantRemovals] = useState<Set<string>>(new Set());
  const [pendingGrantAdditions, setPendingGrantAdditions] = useState<PendingGrant[]>([]);
  // A complete draft never added still counts as a change; the save flushes it.
  const [hasDraftGrant, setHasDraftGrant] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const grantInputRef = useRef<GrantInputRowHandle>(null);

  const reset = () => {
    setPendingSeat(memberSeat);
    setPendingGrantRemovals(new Set());
    setPendingGrantAdditions([]);
    setHasDraftGrant(false);
  };
  const keepStagedOnRoleRefresh = useResetStaged({
    organizationId,
    userId,
    memberSeat,
    reset,
    setPendingSeat,
  });
  // One visit per opening of a member, so reopening the same member is a new visit: an answer
  // for a visit since closed leaves the editor alone.
  const thisMember = memberKey({ organizationId, userId });
  const thisVisit = useMemo(() => ({ member: thisMember }), [thisMember]);
  const openVisit = useRef(thisVisit);
  useEffect(() => {
    openVisit.current = thisVisit;
  }, [thisVisit]);

  const directGrants = api.authz.listMemberGrants.useQuery(
    { organizationId, userId },
    { enabled: canManage },
  );
  const memberGroups = api.group.listForMember.useQuery({ organizationId, userId });
  const updateOrgRole = api.organization.updateMemberRole.useMutation();
  const applyMemberGrants = api.authz.applyMemberGrants.useMutation();

  const roleChanged = pendingSeat !== memberSeat;
  const hasChanges =
    pendingGrantRemovals.size > 0 ||
    pendingGrantAdditions.length > 0 ||
    roleChanged ||
    hasDraftGrant;

  const stageAddition = (incoming: PendingGrant) => {
    const [addition] = newGrantAdditions({
      staged: [constrainToSeat({ grant: incoming, organizationRole: pendingRole })],
      held: directGrants.data ?? [],
      removals: pendingGrantRemovals,
    });
    if (addition === undefined) return;
    setPendingGrantAdditions((prev) => withStaged({ staged: prev, grant: addition }));
  };

  useStagedFollowsSeat({ pendingSeat, setPendingGrantAdditions, setHasDraftGrant });

  // A role change moves the member between seats and may add one: usage and caps are re-read.
  const refreshAccessQueries = () =>
    Promise.all([
      queryClient.authz.listMemberGrants.invalidate(),
      queryClient.authz.listManagedGrants.invalidate(),
      queryClient.organization.getMemberById.invalidate(),
      queryClient.organization.getOrganizationWithMembersAndTheirTeams.invalidate(),
      queryClient.organization.getAll.invalidate(),
      queryClient.organization.getScopeGraph.invalidate(),
      queryClient.limits.getUsage.invalidate(),
      queryClient.plan.getActivePlan.invalidate(),
      queryClient.licenseEnforcement.checkLimit.invalidate(),
      queryClient.licenseEnforcement.checkAllLimits.invalidate(),
      queryClient.organization.listHeldSeats.invalidate(),
      queryClient.organization.pendingSeatRoleChange.invalidate(),
    ]);

  /** The staged assignment rows as one batch, after the role they were staged against. */
  const applyStagedGrants = async () => {
    const uncommitted =
      pendingSeat === BILLING_ONLY_SEAT ? null : (grantInputRef.current?.flush() ?? null);
    const additions = newGrantAdditions({
      staged: uncommitted ? [...pendingGrantAdditions, uncommitted] : pendingGrantAdditions,
      held: directGrants.data ?? [],
      removals: pendingGrantRemovals,
    });
    if (pendingGrantRemovals.size === 0 && additions.length === 0) return;
    await sendStagedBatch({
      send: () =>
        applyMemberGrants.mutateAsync({
          organizationId,
          userId,
          bindingIdsToDelete: [...pendingGrantRemovals],
          bindingsToCreate: additions.map(bindingToCreate),
        }),
      stillOpen: () => openVisit.current === thisVisit,
      uncommitted,
      removed: pendingGrantRemovals,
      added: pendingGrantAdditions,
      setPendingGrantRemovals,
      setPendingGrantAdditions,
    });
  };

  const seatPanel = useSeatRolePanel({
    organizationId,
    userId,
    canChangeRole,
    pendingSeat,
    setPendingSeat,
    memberSeat,
    onChanged: async ({ teamsLeftWithoutAdmin, roleChanged }) => {
      await saveAfterPaidRole({
        roleChanged,
        setIsSaving,
        applyStagedGrants,
        refresh: refreshAccessQueries,
        onBatchFailed: (error) => {
          if (openVisit.current === thisVisit) keepStagedOnRoleRefresh.current = true;
          showErrorToast({
            error,
            fallbackTitle: "The role changed, but the access rows did not save",
          });
        },
      });
      return teamsLeftWithoutAdminLine(teamsLeftWithoutAdmin);
    },
  });

  const handleSave = async () => {
    setIsSaving(true);
    try {
      let teamsLeftWithoutAdmin: { name: string }[] = [];
      if (roleChanged) {
        const roleResult = await updateOrgRole.mutateAsync({
          organizationId,
          userId,
          role: pendingRole,
        });
        // Defaulted: an older server answers without the field, after the save succeeded.
        teamsLeftWithoutAdmin = roleResult?.teamsLeftWithoutAdmin ?? [];
      }
      await applyStagedGrants();

      await refreshAccessQueries();
      const withoutAdmin = teamsLeftWithoutAdminLine(teamsLeftWithoutAdmin);
      toaster.create({
        title: "Member updated",
        description: withoutAdmin,
        type: "success",
        duration: withoutAdmin ? 10000 : undefined,
      });
    } catch (e) {
      void refreshAccessQueries();
      showErrorToast({ error: e, fallbackTitle: "Couldn't update this member" });
    } finally {
      setIsSaving(false);
    }
  };

  return {
    pendingRole,
    pendingSeat,
    setPendingSeat,
    pendingGrantRemovals,
    setPendingGrantRemovals,
    pendingGrantAdditions,
    setPendingGrantAdditions,
    setHasDraftGrant,
    grantInputRef,
    reset,
    directGrants,
    memberGroups,
    hasChanges,
    isSaving,
    stageAddition,
    handleSave,
    memberSeat,
    ...seatPanel,
  };
}

/** Whether the picked role needs a full seat none is free for, and the purchase that adds one. */
function useSeatRolePanel({
  organizationId,
  userId,
  canChangeRole,
  pendingSeat,
  setPendingSeat,
  memberSeat,
  onChanged,
}: {
  organizationId: string;
  userId: string;
  canChangeRole: boolean;
  pendingSeat: InviteSeat;
  setPendingSeat: (seat: InviteSeat) => void;
  memberSeat: InviteSeat;
  onChanged: (change: SeatRoleChanged) => Promise<string | undefined>;
}) {
  const member = api.organization.getMemberById.useQuery(
    { organizationId, userId },
    { enabled: canChangeRole },
  );
  const memberName = member.data?.user.name ?? member.data?.user.email ?? "This member";
  const usage = api.limits.getUsage.useQuery({ organizationId }, { enabled: canChangeRole });
  const fullSeats = usage.data?.seatLimitInfo?.members;
  const fullSeatsTaken = fullSeats !== undefined && fullSeats.current >= fullSeats.max;
  const needsFullSeat = takesFullSeat(pendingSeat) && !takesFullSeat(memberSeat);
  const seat = useSeatRoleChange({
    organizationId,
    userId,
    memberName,
    enabled: canChangeRole,
    describeRole: (role) => seatLabel({ role }),
    onChanged,
  });
  const step = seat.flow.step;
  // A refused seat leaves the role as it is, so the picker shows the role they still hold.
  useEffect(() => {
    if (step === "stuck") setPendingSeat(memberSeat);
  }, [step, memberSeat, setPendingSeat]);

  // An offer refused for two live subscriptions shows the calm state before any click.
  const blockedOffer =
    seat.offerKind === "blocked" && step === "idle" && needsFullSeat && fullSeatsTaken;
  const blockedRole =
    pendingSeat === OrganizationUserRole.ADMIN
      ? OrganizationUserRole.ADMIN
      : OrganizationUserRole.MEMBER;
  useEffect(() => {
    if (blockedOffer) seat.block({ role: blockedRole });
  }, [blockedOffer, blockedRole, seat]);

  const showSeatPanel = canChangeRole && ((needsFullSeat && fullSeatsTaken) || step !== "idle");
  const offersPurchase =
    seat.offerKind === "charge" ||
    seat.offerKind === "checkout" ||
    seat.offerKind === "blocked" ||
    seat.offerKind === "support";
  return {
    memberName,
    seat,
    showSeatPanel,
    // A change waiting on its payment, or still being sent, drops Save until it settles.
    seatPurchaseOffered:
      showSeatPanel && step !== "done" && (offersPurchase || step === "waiting" || step === "busy"),
    // The staged batch goes as it stood when the change started, so nothing is edited meanwhile.
    seatChangeInFlight: step === "waiting" || step === "busy",
    pickSeat: (next: InviteSeat) => {
      setPendingSeat(next);
      if (step !== "waiting" && step !== "busy") seat.clear();
    },
  };
}

/** A refusal read mid-sentence: lower-cased first letter, no closing full stop. */
function reasonClause(reason: string): string {
  const trimmed = reason.trim().replace(/\.$/, "");
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/** Admin and Member take a full seat; Lite, Developer and Billing only do not. */
function takesFullSeat(seat: InviteSeat): boolean {
  return seat === OrganizationUserRole.ADMIN || seat === OrganizationUserRole.MEMBER;
}

type MemberAccessEditorState = ReturnType<typeof useMemberAccessEditor>;

/** The seat a role change needs: billing's offer, the payment it waits on, or what happened. */
function SeatRolePanel({
  organizationId,
  organizationName,
  editor,
}: {
  organizationId: string;
  organizationName: string;
  editor: MemberAccessEditorState;
}) {
  const { flow } = editor.seat;
  const role = flow.step === "idle" ? editor.pendingRole : flow.role;
  const roleLabel = seatLabel({ role });
  const currentRoleLabel = seatLabel({
    role:
      editor.memberSeat === BILLING_ONLY_SEAT ? OrganizationUserRole.EXTERNAL : editor.memberSeat,
    billingOnly: editor.memberSeat === BILLING_ONLY_SEAT,
  });
  if (flow.step === "seat_only") {
    return (
      <Banner
        status="warning"
        title={`1 seat added and paid, but ${editor.memberName}'s role could not be changed: ${reasonClause(flow.reason)}.`}
        data-testid="seat-role-seat-only"
      >
        The seat is free for anyone.
      </Banner>
    );
  }
  if (flow.step === "waiting") {
    return (
      <Banner
        status="info"
        title="Waiting for the seat payment."
        data-testid="seat-role-waiting"
        action={
          <BannerAction asChild>
            <a href={flow.url} target="_blank" rel="noopener">
              Finish paying on Stripe
            </a>
          </BannerAction>
        }
      >
        {`${editor.memberName} becomes ${roleLabel} as soon as it is paid.`}
      </Banner>
    );
  }
  const offerState =
    flow.step === "busy" || flow.step === "done" || flow.step === "stuck" ? flow.step : "offer";
  return (
    <VStack align="stretch" gap={3}>
      {flow.step === "failed" && (
        <Banner
          status="error"
          title={`The payment didn't go through, so nothing changed. ${editor.memberName} is still ${withArticle(currentRoleLabel)}.`}
          data-testid="seat-role-failed"
        />
      )}
      <SeatRoleOffer
        organizationId={organizationId}
        organizationName={organizationName}
        memberName={editor.memberName}
        roleLabel={roleLabel}
        currentRoleLabel={currentRoleLabel}
        state={offerState}
        onConfirm={(quotedAt) => void editor.seat.start({ role, quotedAt })}
        onKind={editor.seat.setOfferKind}
        onAmountDue={editor.seat.setAmountDue}
      />
    </VStack>
  );
}
