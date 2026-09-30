/** What one member can reach, and the one save that changes it. */

import { Badge, Box, Button, HStack, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import { Link } from "@langwatch/browser-host/link";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { HandledErrorAlert } from "../../behavior/handled-error-form.tsx";
import {
  api,
  type OrganizationApiMap,
  type RoleBindingReading,
} from "../../behavior/organization-api.ts";
import { useOrganizationToaster, useShowErrorToast } from "../../behavior/organization-feedback.ts";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "../../model/prisma-types.ts";
import { IdentityChip } from "../elements/identity-row.tsx";
import { OrganizationUserRoleField } from "../elements/organization-user-role-field.tsx";
import {
  BindingInputRow,
  type BindingInputRowHandle,
  type PendingBinding,
  toggled,
} from "./group-binding-input-row.tsx";

type MemberGroup = OrganizationApiMap["group"]["listForMember"]["query"]["output"][number];

/** Team names as a reader would say them: "A", "A and B", "A, B and C". */
function listTeamNames(names: string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  if (quoted.length <= 1) return quoted[0] ?? "";
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

/** What makes two access rows the same grant, regardless of which row it is. */
function bindingKey(binding: {
  role: string;
  customRoleId?: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
}): string {
  return `${binding.role}:${binding.customRoleId ?? ""}:${binding.scopeType}:${binding.scopeId}`;
}

/** "Organization", "Team Platform", "Project Checkout"; an unresolved name says its kind. */
function scopeLabel({
  scopeType,
  scopeName,
}: {
  scopeType: RoleBindingScopeType;
  scopeName?: string | null;
}): string {
  if (scopeType === RoleBindingScopeType.ORGANIZATION) return "Organization";
  const kind = scopeType === RoleBindingScopeType.TEAM ? "Team" : "Project";
  return scopeName ? `${kind} ${scopeName}` : kind;
}

/** Colour by how much the role can do, not by which one it happens to be. */
function roleTone(role: string): string {
  if (role === "ADMIN") return "red";
  if (role === "MEMBER") return "blue";
  if (role === "VIEWER") return "gray";
  return "purple";
}

/** A Lite Member seat allows Viewer only, so a staged row above it snaps down. */
function constrainToSeat({
  binding,
  organizationRole,
}: {
  binding: PendingBinding;
  organizationRole: OrganizationUserRole;
}): PendingBinding {
  if (organizationRole !== OrganizationUserRole.EXTERNAL) return binding;
  if (!binding.customRoleId && binding.role === TeamUserRole.VIEWER) return binding;
  return {
    ...binding,
    role: TeamUserRole.VIEWER,
    roleValue: TeamUserRole.VIEWER,
    customRoleId: undefined,
    customRoleName: undefined,
  };
}

/** A staged row the member already holds, or the same row staged twice, adds nothing. */
function newBindingAdditions({
  staged,
  held,
  removals,
}: {
  staged: PendingBinding[];
  held: readonly (Parameters<typeof bindingKey>[0] & { id: string })[];
  removals: ReadonlySet<string>;
}): PendingBinding[] {
  const heldKeys = new Set(held.filter((row) => !removals.has(row.id)).map(bindingKey));
  return staged.filter((binding) => {
    const key = bindingKey(binding);
    if (heldKeys.has(key)) return false;
    heldKeys.add(key);
    return true;
  });
}

/** Staged once: the same grant staged again changes nothing. */
function withStaged({
  staged,
  binding,
}: {
  staged: PendingBinding[];
  binding: PendingBinding;
}): PendingBinding[] {
  const key = bindingKey(binding);
  return staged.some((row) => bindingKey(row) === key) ? staged : [...staged, binding];
}

/** A Lite Member seat drops organization rows, snaps the rest to Viewer, collapses duplicates. */
function stagedRowsForLiteSeat(staged: PendingBinding[]): PendingBinding[] {
  return staged
    .filter((binding) => binding.scopeType !== RoleBindingScopeType.ORGANIZATION)
    .map((binding) => constrainToSeat({ binding, organizationRole: OrganizationUserRole.EXTERNAL }))
    .reduce<PendingBinding[]>((kept, binding) => withStaged({ staged: kept, binding }), []);
}

/** The organization row mirroring the seat belongs to the seat selector, not to this list. */
function mirrorsSeat({
  binding,
  seat,
}: {
  binding: { role: string; customRoleId?: string | null; scopeType: RoleBindingScopeType };
  seat: OrganizationUserRole;
}): boolean {
  return (
    binding.scopeType === RoleBindingScopeType.ORGANIZATION &&
    !binding.customRoleId &&
    binding.role === seat
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
  canManage,
  isCurrentUser,
}: {
  organizationId: string;
  userId: string;
  memberRole: OrganizationUserRole;
  canManage: boolean;
  isCurrentUser: boolean;
}) {
  const editor = useMemberAccessEditor({ organizationId, userId, memberRole, canManage });

  return (
    <VStack gap={5} align="stretch" width="full">
      {canManage && (
        <Box>
          <Text fontSize="sm" fontWeight="semibold" mb={3}>
            Organization role
          </Text>
          {isCurrentUser ? (
            <Text fontSize="sm" color="fg.muted" fontStyle="italic">
              You cannot change your own organization role.
            </Text>
          ) : (
            <OrganizationUserRoleField
              value={editor.pendingRole}
              onChange={editor.setPendingRole}
            />
          )}
        </Box>
      )}

      {canManage && (
        <Box>
          <Text fontSize="sm" fontWeight="semibold" mb={3}>
            Role assignments
          </Text>
          <DirectAssignments
            directBindings={editor.directBindings}
            staged={editor.pendingBindingAdditions}
            removals={editor.pendingBindingRemovals}
            seat={memberRole}
            onToggle={(id) =>
              editor.setPendingBindingRemovals((prev) => toggled({ set: prev, id }))
            }
            onUndo={(index) =>
              editor.setPendingBindingAdditions((prev) => prev.filter((_, j) => j !== index))
            }
          />
          <BindingInputRow
            ref={editor.bindingInputRef}
            organizationId={organizationId}
            onAdd={editor.stageAddition}
            onReadyChange={editor.setHasDraftBinding}
            organizationRole={editor.pendingRole}
            buttonLabel="Assign role"
          />
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
          <Button variant="outline" disabled={!editor.hasChanges} onClick={editor.reset}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            disabled={!editor.hasChanges}
            loading={editor.isSaving}
            onClick={() => void editor.handleSave()}
          >
            Save
          </Button>
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
  scopeType: RoleBindingScopeType;
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
  directBindings,
  staged,
  removals,
  seat,
  onToggle,
  onUndo,
}: {
  directBindings: QueryReading<RoleBindingReading[]>;
  staged: PendingBinding[];
  removals: ReadonlySet<string>;
  seat: OrganizationUserRole;
  onToggle: (bindingId: string) => void;
  onUndo: (index: number) => void;
}) {
  if (directBindings.isError) {
    return (
      <HandledErrorAlert
        error={directBindings.error}
        fallbackTitle="Couldn't read their role assignments"
      />
    );
  }
  if (directBindings.isLoading) return <Spinner size="sm" />;
  const held = directBindings.data ?? [];
  if (held.length === 0 && staged.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted" fontStyle="italic">
        No role assigned.
      </Text>
    );
  }
  return (
    <VStack gap={2} align="stretch">
      {held.map((b) => {
        const marked = removals.has(b.id);
        const removable =
          b.scopeType !== RoleBindingScopeType.PROJECT && !mirrorsSeat({ binding: b, seat });
        return (
          <HStack
            key={b.id}
            px={3}
            py={2}
            bg="bg.muted"
            borderRadius="md"
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
                color={marked ? "blue.500" : "fg.muted"}
                aria-label={marked ? "Undo removal" : "Remove assignment"}
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
          key={bindingKey(b)}
          px={3}
          py={2}
          bg="bg.muted"
          borderRadius="md"
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
  if (memberGroups.isLoading) return <Spinner size="sm" />;
  if (!memberGroups.data?.length) {
    return (
      <Text fontSize="sm" color="fg.muted" fontStyle="italic">
        They are in no group.
      </Text>
    );
  }
  return (
    <VStack gap={2} align="stretch">
      {memberGroups.data.map((group) =>
        group.bindings.length === 0 ? (
          <HStack
            key={group.id}
            px={3}
            py={2}
            bg="bg.muted"
            borderRadius="md"
            fontSize="sm"
            justifyContent="space-between"
          >
            <HStack gap={2}>
              <Text fontSize="sm" color="fg.muted">
                {group.name}
              </Text>
              {group.scimSource ? (
                <IdentityChip
                  label="Directory"
                  title={`Membership of this group is managed by ${group.scimSource}.`}
                />
              ) : null}
            </HStack>
            <Link href="/settings/directory?tab=groups" fontSize="xs" color="blue.400">
              No role assigned
            </Link>
          </HStack>
        ) : (
          group.bindings.map((b) => (
            <HStack key={b.id} px={3} py={2} bg="bg.muted" borderRadius="md" fontSize="sm">
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
            </HStack>
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
function useMemberAccessEditor({
  organizationId,
  userId,
  memberRole,
  canManage,
}: {
  organizationId: string;
  userId: string;
  memberRole: OrganizationUserRole;
  canManage: boolean;
}) {
  const toaster = useOrganizationToaster();
  const showErrorToast = useShowErrorToast();
  const queryClient = api.useUtils();

  const [pendingRole, setPendingRole] = useState<OrganizationUserRole>(memberRole);
  const [pendingBindingRemovals, setPendingBindingRemovals] = useState<Set<string>>(new Set());
  const [pendingBindingAdditions, setPendingBindingAdditions] = useState<PendingBinding[]>([]);
  // A complete draft never added still counts as a change; the save flushes it.
  const [hasDraftBinding, setHasDraftBinding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const bindingInputRef = useRef<BindingInputRowHandle>(null);

  const reset = () => {
    setPendingRole(memberRole);
    setPendingBindingRemovals(new Set());
    setPendingBindingAdditions([]);
    setHasDraftBinding(false);
  };
  // Staged rows belong to the member they were staged for, never the next one opened.
  useEffect(reset, [userId, memberRole]);

  const directBindings = api.roleBinding.listForUser.useQuery(
    { organizationId, userId },
    { enabled: canManage },
  );
  const memberGroups = api.group.listForMember.useQuery({ organizationId, userId });
  const updateOrgRole = api.organization.updateMemberRole.useMutation();
  const applyMemberBindings = api.roleBinding.applyMemberBindings.useMutation();

  const roleChanged = pendingRole !== memberRole;
  const hasChanges =
    pendingBindingRemovals.size > 0 ||
    pendingBindingAdditions.length > 0 ||
    roleChanged ||
    hasDraftBinding;

  const stageAddition = (incoming: PendingBinding) => {
    const [addition] = newBindingAdditions({
      staged: [constrainToSeat({ binding: incoming, organizationRole: pendingRole })],
      held: directBindings.data ?? [],
      removals: pendingBindingRemovals,
    });
    if (addition === undefined) return;
    setPendingBindingAdditions((prev) => withStaged({ staged: prev, binding: addition }));
  };

  useEffect(() => {
    if (pendingRole !== OrganizationUserRole.EXTERNAL) return;
    setPendingBindingAdditions(stagedRowsForLiteSeat);
  }, [pendingRole]);

  // A role change moves the member between full and Lite seats, so seat usage is re-read too.
  const refreshAccessQueries = () =>
    Promise.all([
      queryClient.roleBinding.listForUser.invalidate(),
      queryClient.roleBinding.listForOrg.invalidate(),
      queryClient.organization.getMemberById.invalidate(),
      queryClient.organization.getOrganizationWithMembersAndTheirTeams.invalidate(),
      queryClient.organization.getAll.invalidate(),
      queryClient.limits.getUsage.invalidate(),
    ]);

  const handleSave = async () => {
    const uncommitted = bindingInputRef.current?.flush() ?? null;
    const additions = newBindingAdditions({
      staged: uncommitted ? [...pendingBindingAdditions, uncommitted] : pendingBindingAdditions,
      held: directBindings.data ?? [],
      removals: pendingBindingRemovals,
    });

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
      if (pendingBindingRemovals.size > 0 || additions.length > 0) {
        await applyMemberBindings.mutateAsync({
          organizationId,
          userId,
          bindingIdsToDelete: [...pendingBindingRemovals],
          bindingsToCreate: additions.map((b) => ({
            role: b.role,
            customRoleId: b.customRoleId,
            scopeType: b.scopeType,
            scopeId: b.scopeId,
          })),
        });
      }

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
    setPendingRole,
    pendingBindingRemovals,
    setPendingBindingRemovals,
    pendingBindingAdditions,
    setPendingBindingAdditions,
    setHasDraftBinding,
    bindingInputRef,
    reset,
    directBindings,
    memberGroups,
    hasChanges,
    isSaving,
    stageAddition,
    handleSave,
  };
}
