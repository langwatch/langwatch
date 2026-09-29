import { Badge, Box, Button, HStack, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import { Link } from "@langwatch/browser-host/link";
import { Dialog } from "@langwatch/design-system/dialog";
import { useEffect, useRef, useState } from "react";

import { api } from "../../behavior/organization-api.ts";
import { useOrganizationToaster, useShowErrorToast } from "../../behavior/organization-feedback.ts";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "../../model/prisma-types.ts";
import { ProvenanceExplanation } from "../elements/member-provenance.tsx";
import { OrganizationUserRoleField } from "../elements/organization-user-role-field.tsx";
import {
  BindingInputRow,
  type BindingInputRowHandle,
  type BindingRowShape,
  DirectBindingRow,
  type PendingBinding,
  roleBadgeColor,
  scopeTypeLabel,
  StagedBindingRow,
  toggled,
} from "./group-binding-input-row.tsx";

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

type MemberSummary = {
  userId: string;
  role: OrganizationUserRole;
  user: { name: string | null; email: string | null };
};

type MemberGroup = {
  id: string;
  name: string;
  bindings: (Omit<BindingRowShape, "scopeId"> & { id: string })[];
};

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

/**
 * The batch describes the access the admin wants the member to hold, so a staged row the
 * member already holds (or the same row staged twice) adds nothing to it.
 */
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

/**
 * Picking a Lite Member seat rewrites the staged rows the way the save cascade rewrites the
 * stored ones: above-Viewer rows snap down, organization rows are dropped, duplicates collapse.
 */
function stagedRowsForLiteSeat(staged: PendingBinding[]): PendingBinding[] {
  return staged
    .filter((binding) => binding.scopeType !== RoleBindingScopeType.ORGANIZATION)
    .map((binding) => constrainToSeat({ binding, organizationRole: OrganizationUserRole.EXTERNAL }))
    .reduce<PendingBinding[]>((kept, binding) => withStaged({ staged: kept, binding }), []);
}

/**
 * The organization row mirroring the seat is managed by the seat selector: deleting it would
 * leave the seat without its binding, and the next role change would recreate it. Custom-role
 * and off-seat organization rows are real grants and stay removable.
 */
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
    binding.role === (seat as string)
  );
}

/**
 * A seat correction is allowed to take away a team's only team-scoped admin, so this is where
 * the admin who did it finds out — as a consequence, since organization admins can still manage
 * those teams and nothing needs repairing.
 */
function memberUpdatedToast(teamsLeftWithoutAdmin: { name: string }[]) {
  if (teamsLeftWithoutAdmin.length === 0) {
    return {
      title: "Member updated",
      description: undefined,
      type: "success",
      duration: undefined,
    };
  }
  const one = teamsLeftWithoutAdmin.length === 1;
  return {
    title: "Member updated",
    description: `${listTeamNames(teamsLeftWithoutAdmin.map((team) => team.name))} no longer ${one ? "has" : "have"} a team admin. Organization admins can still manage ${one ? "it" : "them"}.`,
    type: "success",
    duration: 10000,
  };
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
    role !== (TeamUserRole.VIEWER as string) &&
    role !== (TeamUserRole.CUSTOM as string)
  );
}

function GroupAccessList({
  groups,
  organizationRole,
}: {
  groups: MemberGroup[];
  organizationRole: OrganizationUserRole;
}) {
  return (
    <VStack gap={2} align="stretch">
      {groups.map((group) =>
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
            <Text fontSize="sm" color="fg.muted">
              {group.name}
            </Text>
            <Link href="/settings/directory?tab=groups" fontSize="xs" color="blue.400">
              No access configured
            </Link>
          </HStack>
        ) : (
          group.bindings.map((b) => (
            <HStack key={b.id} px={3} py={2} bg="bg.muted" borderRadius="md" fontSize="sm">
              <Badge colorPalette={roleBadgeColor(b.role)} size="sm">
                {b.customRoleName ?? b.role}
              </Badge>
              <Text color="fg.muted">on</Text>
              <Badge colorPalette="purple" size="sm">
                {scopeTypeLabel(b.scopeType)} {b.scopeName ?? "—"}
              </Badge>
              {appliesAsViewer({ role: b.role, organizationRole }) && (
                <Text fontSize="xs" color="fg.muted">
                  Applies as Viewer while on a Lite Member seat
                </Text>
              )}
              <Spacer />
              <Text fontSize="xs" color="fg.muted">
                via {group.name}
              </Text>
            </HStack>
          ))
        ),
      )}
    </VStack>
  );
}

function AccessList({
  isLoading,
  direct,
  staged,
  removals,
  seat,
  onToggle,
  onUndo,
}: {
  isLoading: boolean;
  direct: (BindingRowShape & { id: string; customRoleId?: string | null })[];
  staged: PendingBinding[];
  removals: ReadonlySet<string>;
  seat: OrganizationUserRole;
  onToggle: (bindingId: string) => void;
  onUndo: (index: number) => void;
}) {
  if (isLoading) return <Spinner size="sm" />;
  if (direct.length === 0 && staged.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted" fontStyle="italic">
        No access configured.
      </Text>
    );
  }
  return (
    <VStack gap={2} align="stretch">
      {direct.map((b) => (
        <DirectBindingRow
          key={b.id}
          binding={b}
          markedForRemoval={removals.has(b.id)}
          removable={
            b.scopeType !== RoleBindingScopeType.PROJECT && !mirrorsSeat({ binding: b, seat })
          }
          onToggle={() => onToggle(b.id)}
        />
      ))}
      {staged.map((b, i) => (
        <StagedBindingRow key={i} binding={b} onUndo={() => onUndo(i)} />
      ))}
    </VStack>
  );
}

function WhyTheyAreHere({
  failed,
  provenance,
}: {
  failed: boolean;
  provenance: Parameters<typeof ProvenanceExplanation>[0]["provenance"];
}) {
  return (
    <Box>
      <Text fontSize="sm" fontWeight="semibold" mb={3}>
        Why they are here
      </Text>
      {failed ? (
        <Text fontSize="sm" color="fg.muted">
          We couldn&apos;t work that out just now.
        </Text>
      ) : (
        <ProvenanceExplanation provenance={provenance} />
      )}
    </Box>
  );
}

function OrganizationRoleSection({
  isCurrentUser,
  value,
  onChange,
}: {
  isCurrentUser: boolean;
  value: OrganizationUserRole;
  onChange: (role: OrganizationUserRole) => void;
}) {
  return (
    <Box>
      <Text fontSize="sm" fontWeight="semibold" mb={3}>
        Organization role
      </Text>
      {isCurrentUser ? (
        <Text fontSize="sm" color="fg.muted" fontStyle="italic">
          You cannot change your own organization role.
        </Text>
      ) : (
        <OrganizationUserRoleField value={value} onChange={onChange} />
      )}
    </Box>
  );
}

function GroupAccessSection({
  isLoading,
  groups,
  organizationRole,
}: {
  isLoading: boolean;
  groups: MemberGroup[];
  organizationRole: OrganizationUserRole;
}) {
  return (
    <Box>
      <Text fontSize="sm" fontWeight="semibold" mb={3}>
        Group access
      </Text>
      {isLoading && <Spinner size="sm" />}
      {!isLoading && groups.length === 0 && (
        <Text fontSize="sm" color="fg.muted" fontStyle="italic">
          Not a member of any groups.
        </Text>
      )}
      {!isLoading && groups.length > 0 && (
        <GroupAccessList groups={groups} organizationRole={organizationRole} />
      )}
    </Box>
  );
}

export function MemberDetailDialog({
  member,
  organizationId,
  canManage,
  isCurrentUser,
  open,
  onClose,
}: {
  member: MemberSummary;
  organizationId: string;
  canManage: boolean;
  isCurrentUser: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const toaster = useOrganizationToaster();
  const showErrorToast = useShowErrorToast();
  const queryClient = api.useUtils();

  const [pendingRole, setPendingRole] = useState<OrganizationUserRole>(member.role);
  const [pendingBindingRemovals, setPendingBindingRemovals] = useState<Set<string>>(new Set());
  const [pendingBindingAdditions, setPendingBindingAdditions] = useState<PendingBinding[]>([]);
  // The input row holds a complete draft the admin never pressed Add on. It
  // counts as a change so Save is enabled, and the save flushes it.
  const [hasDraftBinding, setHasDraftBinding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const bindingInputRef = useRef<BindingInputRowHandle>(null);
  // Asked apart from the member: a failed read costs one sentence, never the dialog.
  const provenance = api.organization.getMemberProvenance.useQuery(
    { organizationId },
    { enabled: open && canManage },
  );

  const reset = () => {
    setPendingRole(member.role);
    setPendingBindingRemovals(new Set());
    setPendingBindingAdditions([]);
    setHasDraftBinding(false);
  };

  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, member.userId]);

  const directBindings = api.roleBinding.listForUser.useQuery(
    { organizationId, userId: member.userId },
    { enabled: open && canManage },
  );
  const memberGroups = api.group.listForMember.useQuery(
    { organizationId, userId: member.userId },
    { enabled: open },
  );

  const updateOrgRole = api.organization.updateMemberRole.useMutation();
  const applyMemberBindings = api.roleBinding.applyMemberBindings.useMutation();

  const hasBindingChanges = pendingBindingRemovals.size > 0 || pendingBindingAdditions.length > 0;
  const roleChanged = pendingRole !== member.role;
  const hasChanges = hasBindingChanges || roleChanged || hasDraftBinding;

  // A Lite Member seat allows Viewer only, so anything staged above it snaps
  // down before it is listed or saved. The input row already restricts what
  // can be picked; this holds the same line for rows staged before the seat
  // was switched, and for whatever a stubbed row hands over in tests.
  const constrainStagedRowToSeat = (binding: PendingBinding): PendingBinding =>
    constrainToSeat({ binding, organizationRole: pendingRole });

  const stageAddition = (incoming: PendingBinding) => {
    const binding = constrainStagedRowToSeat(incoming);
    const [addition] = newBindingAdditions({
      staged: [binding],
      held: directBindings.data ?? [],
      removals: pendingBindingRemovals,
    });
    if (addition === undefined) return;
    setPendingBindingAdditions((prev) => withStaged({ staged: prev, binding: addition }));
  };

  // Picking a Lite Member seat rewrites the staged rows the way the save
  // cascade rewrites the stored ones: above-Viewer rows snap down, an
  // organization row has no lite equivalent and is dropped, and rows made
  // identical by the correction collapse to one.
  useEffect(() => {
    if (pendingRole !== OrganizationUserRole.EXTERNAL) return;
    setPendingBindingAdditions(stagedRowsForLiteSeat);
  }, [pendingRole]);

  const refreshAccessQueries = () =>
    Promise.all([
      queryClient.roleBinding.listForUser.invalidate(),
      queryClient.roleBinding.listForOrg.invalidate(),
      queryClient.organization.getOrganizationWithMembersAndTheirTeams.invalidate(),
      queryClient.organization.getAll.invalidate(),
      // An org role change moves the member between full and Lite Member
      // seats, so the seat counts an admin is reconciling against changed
      // with this save.
      queryClient.limits.getUsage.invalidate(),
    ]);

  const handleSave = async () => {
    // Auto-stage any uncommitted binding row (user selected fields but didn't click Add)
    const uncommitted = bindingInputRef.current?.flush() ?? null;
    const stagedAdditions = uncommitted
      ? [...pendingBindingAdditions, uncommitted]
      : pendingBindingAdditions;
    // The batch describes the access the admin wants the member to hold, so
    // a staged row the member already holds (or the same row staged twice)
    // adds nothing to it.
    const allBindingAdditions = newBindingAdditions({
      staged: stagedAdditions,
      held: directBindings.data ?? [],
      removals: pendingBindingRemovals,
    });
    const hasBindingChangesNow = pendingBindingRemovals.size > 0 || allBindingAdditions.length > 0;

    setIsSaving(true);
    try {
      // Apply org role first — it has license/plan checks that should block the
      // whole save if they fail. Bindings then run as a single transactional
      // batch so they cannot leave a partial state behind.
      let teamsLeftWithoutAdmin: { id: string; name: string }[] = [];
      if (roleChanged) {
        const roleResult = await updateOrgRole.mutateAsync({
          organizationId,
          userId: member.userId,
          role: pendingRole,
        });
        // Defaulted rather than read straight off: during a rollout this code
        // can reach a server that answers without the field, and the save has
        // already succeeded by then. Losing the disclosure line is a worse
        // outcome than nothing only in theory; telling somebody their
        // successful save failed is one in practice.
        teamsLeftWithoutAdmin = roleResult?.teamsLeftWithoutAdmin ?? [];
      }

      if (hasBindingChangesNow) {
        await applyMemberBindings.mutateAsync({
          organizationId,
          userId: member.userId,
          bindingIdsToDelete: [...pendingBindingRemovals],
          bindingsToCreate: allBindingAdditions.map((b) => ({
            role: b.role,
            customRoleId: b.customRoleId,
            scopeType: b.scopeType,
            scopeId: b.scopeId,
          })),
        });
      }

      await refreshAccessQueries();
      toaster.create(memberUpdatedToast(teamsLeftWithoutAdmin));
      onClose();
    } catch (e) {
      // The role change lands before the binding batch, so a failure here can
      // sit on top of a half-applied save. Re-read rather than keep showing
      // rows the server already rewrote — reloading the page to find out what
      // actually happened is the customer experience this replaces.
      void refreshAccessQueries();
      showErrorToast({
        error: e,
        fallbackTitle: "Couldn't update this member",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) {
          reset();
          onClose();
        }
      }}
      size="lg"
    >
      <Dialog.Content bg="bg" maxHeight="90vh" overflowY="auto">
        <Dialog.Header>
          <Dialog.Title>{member.user.name ?? member.user.email}</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body pb={6}>
          <VStack gap={5} align="stretch">
            {canManage && (
              <WhyTheyAreHere
                failed={provenance.isError}
                provenance={provenance.data?.[member.userId]}
              />
            )}

            {/* Organization role */}
            {canManage && (
              <OrganizationRoleSection
                isCurrentUser={isCurrentUser}
                value={pendingRole}
                onChange={setPendingRole}
              />
            )}

            {/* Direct access bindings */}
            {canManage && (
              <Box>
                <Text fontSize="sm" fontWeight="semibold" mb={3}>
                  Access
                </Text>

                <AccessList
                  isLoading={directBindings.isLoading}
                  direct={directBindings.data ?? []}
                  staged={pendingBindingAdditions}
                  removals={pendingBindingRemovals}
                  seat={member.role}
                  onToggle={(id) => setPendingBindingRemovals((prev) => toggled({ set: prev, id }))}
                  onUndo={(index) =>
                    setPendingBindingAdditions((prev) => prev.filter((_, j) => j !== index))
                  }
                />

                <BindingInputRow
                  ref={bindingInputRef}
                  organizationId={organizationId}
                  onAdd={stageAddition}
                  onReadyChange={setHasDraftBinding}
                  organizationRole={pendingRole}
                />
              </Box>
            )}

            {/* Group access */}
            <GroupAccessSection
              isLoading={memberGroups.isLoading}
              groups={memberGroups.data ?? []}
              organizationRole={pendingRole}
            />
          </VStack>
        </Dialog.Body>

        {canManage && (
          <Dialog.Footer>
            <Button
              variant="outline"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              disabled={!hasChanges}
              loading={isSaving}
              onClick={() => void handleSave()}
            >
              Save
            </Button>
          </Dialog.Footer>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
