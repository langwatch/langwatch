import {
  Badge,
  Box,
  Button,
  HStack,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { api } from "~/utils/api";
import {
  BindingInputRow,
  type BindingInputRowHandle,
  type PendingBinding,
} from "../settings/GroupBindingInputRow";
import { OrganizationUserRoleField } from "../settings/OrganizationUserRoleField";
import { SectionErrorNotice } from "../settings/SectionErrorNotice";
import { IdentityChip } from "./IdentityRow";
import { ROLE_ASSIGNMENT_WORDS, roleTone, scopeLabel } from "./roleAssignments";

/**
 * What one member can reach, and the one save that changes it.
 *
 * Lifted out of the member dialog it used to live in so the person drawer can
 * host it (drawers.md: a person is a URL, not a `useState` flag). The staged
 * editing rules came with it unchanged, because each of them is load-bearing:
 * the seat constrains what may be assigned, an organization-scoped row that
 * merely mirrors the seat is not separately removable, and the role is saved
 * before the assignments so a plan refusal stops the whole save.
 *
 * The words are the industry's, not the engine's. Underneath, this writes
 * role BINDINGS to principals at scopes (ADR-092) and the code goes on saying
 * so; on screen a role is ASSIGNED to somebody ON something, because that is
 * what every identity product a customer has used calls it.
 */

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

export function MemberAccessEditor({
  organizationId,
  userId,
  memberRole,
  canManage,
  isCurrentUser,
  onSaved,
}: {
  organizationId: string;
  userId: string;
  memberRole: OrganizationUserRole;
  canManage: boolean;
  isCurrentUser: boolean;
  onSaved?: () => void;
}) {
  const queryClient = api.useUtils();

  const [pendingRole, setPendingRole] =
    useState<OrganizationUserRole>(memberRole);
  const [pendingBindingRemovals, setPendingBindingRemovals] = useState<
    Set<string>
  >(new Set());
  const [pendingBindingAdditions, setPendingBindingAdditions] = useState<
    PendingBinding[]
  >([]);
  // The input row holds a complete draft the admin never pressed the assign
  // button on. It counts as a change so Save is enabled, and the save flushes
  // it.
  const [hasDraftBinding, setHasDraftBinding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const bindingInputRef = useRef<BindingInputRowHandle>(null);

  const reset = () => {
    setPendingRole(memberRole);
    setPendingBindingRemovals(new Set());
    setPendingBindingAdditions([]);
    setHasDraftBinding(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, [userId, memberRole]);

  const directBindings = api.roleBinding.listForUser.useQuery(
    { organizationId, userId },
    { enabled: canManage },
  );
  const memberGroups = api.group.listForMember.useQuery({
    organizationId,
    userId,
  });

  const updateOrgRole = api.organization.updateMemberRole.useMutation();
  const applyMemberBindings = api.roleBinding.applyMemberBindings.useMutation();

  const hasBindingChanges =
    pendingBindingRemovals.size > 0 || pendingBindingAdditions.length > 0;
  const roleChanged = pendingRole !== memberRole;
  const hasChanges = hasBindingChanges || roleChanged || hasDraftBinding;

  // A Lite Member seat allows Viewer only, so anything staged above it snaps
  // down before it is listed or saved. The input row already restricts what
  // can be picked; this holds the same line for rows staged before the seat
  // was switched, and for whatever a stubbed row hands over in tests.
  const constrainStagedRowToSeat = (binding: PendingBinding): PendingBinding =>
    pendingRole === OrganizationUserRole.EXTERNAL &&
    (binding.customRoleId || binding.role !== (TeamUserRole.VIEWER as string))
      ? {
          ...binding,
          role: TeamUserRole.VIEWER,
          roleValue: TeamUserRole.VIEWER,
          customRoleId: undefined,
          customRoleName: undefined,
        }
      : binding;

  const stageAddition = (incoming: PendingBinding) => {
    const binding = constrainStagedRowToSeat(incoming);
    const alreadyHeld = (directBindings.data ?? []).some(
      (row) =>
        !pendingBindingRemovals.has(row.id) &&
        bindingKey(row) === bindingKey(binding),
    );
    if (alreadyHeld) return;
    setPendingBindingAdditions((prev) =>
      prev.some((staged) => bindingKey(staged) === bindingKey(binding))
        ? prev
        : [...prev, binding],
    );
  };

  // Picking a Lite Member seat rewrites the staged rows the way the save
  // cascade rewrites the stored ones: above-Viewer rows snap down, an
  // organization row has no lite equivalent and is dropped, and rows made
  // identical by the correction collapse to one.
  useEffect(() => {
    if (pendingRole !== OrganizationUserRole.EXTERNAL) return;
    setPendingBindingAdditions((prev) => {
      const seen = new Set<string>();
      return prev
        .filter(
          (binding) => binding.scopeType !== RoleBindingScopeType.ORGANIZATION,
        )
        .map(constrainStagedRowToSeat)
        .filter((binding) => {
          const key = bindingKey(binding);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRole]);

  const refreshAccessQueries = () =>
    Promise.all([
      queryClient.roleBinding.listForUser.invalidate(),
      queryClient.roleBinding.listForOrg.invalidate(),
      queryClient.organization.getMemberById.invalidate(),
      queryClient.organization.getOrganizationWithMembersAndTheirTeams.invalidate(),
      queryClient.organization.getAll.invalidate(),
      // An org role change moves the member between full and Lite Member
      // seats, so the seat counts an admin is reconciling against changed
      // with this save.
      queryClient.limits.getUsage.invalidate(),
    ]);

  const handleSave = async () => {
    // Auto-stage any uncommitted row (fields chosen but never assigned).
    const uncommitted = bindingInputRef.current?.flush() ?? null;
    const stagedAdditions = uncommitted
      ? [...pendingBindingAdditions, uncommitted]
      : pendingBindingAdditions;
    // The batch describes the access the admin wants the member to hold, so
    // a staged row the member already holds (or the same row staged twice)
    // adds nothing to it.
    const heldKeys = new Set(
      (directBindings.data ?? [])
        .filter((row) => !pendingBindingRemovals.has(row.id))
        .map(bindingKey),
    );
    const allBindingAdditions = stagedAdditions.filter((binding) => {
      const key = bindingKey(binding);
      if (heldKeys.has(key)) return false;
      heldKeys.add(key);
      return true;
    });
    const hasBindingChangesNow =
      pendingBindingRemovals.size > 0 || allBindingAdditions.length > 0;

    setIsSaving(true);
    try {
      // Apply org role first — it has license/plan checks that should block
      // the whole save if they fail. Assignments then run as a single
      // transactional batch so they cannot leave a partial state behind.
      let teamsLeftWithoutAdmin: Array<{ id: string; name: string }> = [];
      if (roleChanged) {
        const roleResult = await updateOrgRole.mutateAsync({
          organizationId,
          userId,
          role: pendingRole,
        });
        // Defaulted rather than read straight off: during a rollout this code
        // can reach a server that answers without the field, and the save has
        // already succeeded by then.
        teamsLeftWithoutAdmin = roleResult?.teamsLeftWithoutAdmin ?? [];
      }

      if (hasBindingChangesNow) {
        await applyMemberBindings.mutateAsync({
          organizationId,
          userId,
          bindingIdsToDelete: [...pendingBindingRemovals],
          bindingsToCreate: allBindingAdditions.map((b) => ({
            role: b.role as TeamUserRole,
            customRoleId: b.customRoleId,
            scopeType: b.scopeType,
            scopeId: b.scopeId,
          })),
        });
      }

      await refreshAccessQueries();
      toaster.create({
        title: "Member updated",
        // A seat correction is allowed to take away a team's only team-scoped
        // admin, so this is the one place the admin who did it finds out.
        description:
          teamsLeftWithoutAdmin.length > 0
            ? `${listTeamNames(teamsLeftWithoutAdmin.map((team) => team.name))} no longer ${teamsLeftWithoutAdmin.length === 1 ? "has" : "have"} a team admin. Organization admins can still manage ${teamsLeftWithoutAdmin.length === 1 ? "it" : "them"}.`
            : undefined,
        type: "success",
        duration: teamsLeftWithoutAdmin.length > 0 ? 10000 : undefined,
      });
      onSaved?.();
    } catch (e) {
      // The role change lands before the batch, so a failure here can sit on
      // top of a half-applied save. Re-read rather than keep showing rows the
      // server already rewrote.
      void refreshAccessQueries();
      showErrorToast({
        error: e,
        fallbackTitle: "Couldn't update this member",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const userDirectBindings = directBindings.data ?? [];

  // The organization-scoped row that mirrors the member's seat is managed by
  // the seat selector above, not by this list: removing it would leave the
  // seat without its assignment and the next role change would recreate it.
  const mirrorsTheSeat = (binding: {
    role: string;
    customRoleId?: string | null;
    scopeType: RoleBindingScopeType;
  }) =>
    binding.scopeType === RoleBindingScopeType.ORGANIZATION &&
    !binding.customRoleId &&
    binding.role === (memberRole as string);

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
              value={pendingRole}
              onChange={setPendingRole}
            />
          )}
        </Box>
      )}

      {canManage && (
        <Box>
          <Text fontSize="sm" fontWeight="semibold" mb={3}>
            {ROLE_ASSIGNMENT_WORDS.plural}
          </Text>

          {directBindings.isError ? (
            <SectionErrorNotice
              error={directBindings.error}
              fallbackTitle="Couldn't read their role assignments"
            />
          ) : directBindings.isLoading ? (
            <Spinner size="sm" />
          ) : userDirectBindings.length === 0 &&
            pendingBindingAdditions.length === 0 ? (
            <Text fontSize="sm" color="fg.muted" fontStyle="italic">
              No role assigned.
            </Text>
          ) : (
            <VStack gap={2} align="stretch">
              {userDirectBindings.map((b) => {
                const markedForRemoval = pendingBindingRemovals.has(b.id);
                return (
                  <HStack
                    key={b.id}
                    px={3}
                    py={2}
                    bg="bg.muted"
                    borderRadius="md"
                    fontSize="sm"
                    opacity={markedForRemoval ? 0.4 : 1}
                    transition="opacity 0.15s"
                  >
                    <Badge
                      colorPalette={roleTone(b.role)}
                      size="sm"
                      textDecoration={
                        markedForRemoval ? "line-through" : undefined
                      }
                    >
                      {b.customRoleName ?? b.role}
                    </Badge>
                    <Text color="fg.muted">on</Text>
                    <Badge
                      colorPalette="purple"
                      size="sm"
                      variant="surface"
                      textDecoration={
                        markedForRemoval ? "line-through" : undefined
                      }
                    >
                      {scopeLabel(b)}
                    </Badge>
                    <Spacer />
                    {b.scopeType !== RoleBindingScopeType.PROJECT &&
                      !mirrorsTheSeat(b) && (
                        <Button
                          size="xs"
                          variant="ghost"
                          color={markedForRemoval ? "blue.500" : "fg.muted"}
                          aria-label={
                            markedForRemoval
                              ? "Undo removal"
                              : ROLE_ASSIGNMENT_WORDS.remove
                          }
                          onClick={() =>
                            setPendingBindingRemovals((prev) => {
                              const next = new Set(prev);
                              if (next.has(b.id)) next.delete(b.id);
                              else next.add(b.id);
                              return next;
                            })
                          }
                        >
                          <X size={14} />
                        </Button>
                      )}
                  </HStack>
                );
              })}
              {pendingBindingAdditions.map((b, i) => (
                <HStack
                  key={bindingKey(b)}
                  px={3}
                  py={2}
                  bg="bg.muted"
                  borderRadius="md"
                  fontSize="sm"
                  opacity={0.7}
                >
                  <Badge colorPalette={roleTone(b.role)} size="sm">
                    {b.customRoleName ?? b.role}
                  </Badge>
                  <Text color="fg.muted">on</Text>
                  <Badge colorPalette="purple" size="sm" variant="surface">
                    {scopeLabel({
                      scopeType: b.scopeType,
                      scopeName: b.scopeName ?? null,
                    })}
                  </Badge>
                  <Spacer />
                  <Button
                    size="xs"
                    variant="ghost"
                    color="fg.muted"
                    aria-label="Undo add"
                    onClick={() =>
                      setPendingBindingAdditions((prev) =>
                        prev.filter((_, j) => j !== i),
                      )
                    }
                  >
                    <X size={14} />
                  </Button>
                </HStack>
              ))}
            </VStack>
          )}

          <BindingInputRow
            ref={bindingInputRef}
            organizationId={organizationId}
            onAdd={stageAddition}
            onReadyChange={setHasDraftBinding}
            organizationRole={pendingRole}
            buttonLabel={ROLE_ASSIGNMENT_WORDS.create}
          />
        </Box>
      )}

      <Box>
        <Text fontSize="sm" fontWeight="semibold" mb={3}>
          Groups
        </Text>
        {memberGroups.isError ? (
          <HandledErrorAlert
            error={memberGroups.error}
            fallbackTitle="Couldn't read their groups"
          />
        ) : memberGroups.isLoading ? (
          <Spinner size="sm" />
        ) : !memberGroups.data?.length ? (
          <Text fontSize="sm" color="fg.muted" fontStyle="italic">
            They are in no group.
          </Text>
        ) : (
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
                  <Link
                    href="/settings/directory?tab=groups"
                    fontSize="xs"
                    color="blue.400"
                  >
                    No role assigned
                  </Link>
                </HStack>
              ) : (
                group.bindings.map((b) => (
                  <HStack
                    key={b.id}
                    px={3}
                    py={2}
                    bg="bg.muted"
                    borderRadius="md"
                    fontSize="sm"
                  >
                    <Badge colorPalette={roleTone(b.role)} size="sm">
                      {b.customRoleName ?? b.role}
                    </Badge>
                    <Text color="fg.muted">on</Text>
                    <Badge colorPalette="purple" size="sm" variant="surface">
                      {scopeLabel({
                        scopeType: b.scopeType,
                        scopeName: b.scopeName ?? null,
                      })}
                    </Badge>
                    {pendingRole === OrganizationUserRole.EXTERNAL &&
                      b.role !== (TeamUserRole.VIEWER as string) &&
                      b.role !== (TeamUserRole.CUSTOM as string) && (
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
        )}
      </Box>

      {canManage && (
        <HStack justifyContent="flex-end" gap={2}>
          <Button variant="outline" disabled={!hasChanges} onClick={reset}>
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
        </HStack>
      )}
    </VStack>
  );
}
