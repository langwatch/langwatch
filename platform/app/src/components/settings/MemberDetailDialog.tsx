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
import {
  type OrganizationUserRole,
  RoleBindingScopeType,
  type TeamUserRole,
} from "@prisma/client";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import {
  BindingInputRow,
  type BindingInputRowHandle,
  type PendingBinding,
  roleBadgeColor,
  scopeTypeLabel,
} from "./GroupBindingInputRow";
import { OrganizationUserRoleField } from "./OrganizationUserRoleField";

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
  const queryClient = api.useContext();

  const [pendingRole, setPendingRole] = useState<OrganizationUserRole>(
    member.role,
  );
  const [pendingBindingRemovals, setPendingBindingRemovals] = useState<
    Set<string>
  >(new Set());
  const [pendingBindingAdditions, setPendingBindingAdditions] = useState<
    PendingBinding[]
  >([]);
  const [isSaving, setIsSaving] = useState(false);

  const bindingInputRef = useRef<BindingInputRowHandle>(null);

  const reset = () => {
    setPendingRole(member.role);
    setPendingBindingRemovals(new Set());
    setPendingBindingAdditions([]);
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

  const hasBindingChanges =
    pendingBindingRemovals.size > 0 || pendingBindingAdditions.length > 0;
  const roleChanged = pendingRole !== member.role;
  const hasChanges = hasBindingChanges || roleChanged;

  const stageAddition = (binding: PendingBinding) => {
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
      // Apply org role first — it has license/plan checks that should block the
      // whole save if they fail. Bindings then run as a single transactional
      // batch so they cannot leave a partial state behind.
      let teamsLeftWithoutAdmin: Array<{ id: string; name: string }> = [];
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
        // admin, so this is the one place the admin who did it finds out. It
        // reads as a consequence rather than a warning, because organization
        // admins can still manage those teams and nothing needs repairing.
        description:
          teamsLeftWithoutAdmin.length > 0
            ? `${listTeamNames(teamsLeftWithoutAdmin.map((team) => team.name))} no longer ${teamsLeftWithoutAdmin.length === 1 ? "has" : "have"} a team admin. Organization admins can still manage ${teamsLeftWithoutAdmin.length === 1 ? "it" : "them"}.`
            : undefined,
        type: "success",
        duration: teamsLeftWithoutAdmin.length > 0 ? 10000 : undefined,
        meta: { closable: true },
      });
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

  const userDirectBindings = directBindings.data ?? [];

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
            {/* Organization role */}
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

            {/* Direct access bindings */}
            {canManage && (
              <Box>
                <Text fontSize="sm" fontWeight="semibold" mb={3}>
                  Access
                </Text>

                {directBindings.isLoading ? (
                  <Spinner size="sm" />
                ) : userDirectBindings.length === 0 &&
                  pendingBindingAdditions.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted" fontStyle="italic">
                    No access configured.
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
                            colorPalette={roleBadgeColor(b.role)}
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
                            textDecoration={
                              markedForRemoval ? "line-through" : undefined
                            }
                          >
                            {scopeTypeLabel(b.scopeType)}{" "}
                            {b.scopeName ?? b.scopeId}
                          </Badge>
                          <Spacer />
                          {b.scopeType !== RoleBindingScopeType.PROJECT && (
                            <Button
                              size="xs"
                              variant="ghost"
                              color={markedForRemoval ? "blue.500" : "fg.muted"}
                              aria-label={
                                markedForRemoval
                                  ? "Undo removal"
                                  : "Remove binding"
                              }
                              onClick={() =>
                                setPendingBindingRemovals((prev) => {
                                  const next = new Set(prev);
                                  next.has(b.id)
                                    ? next.delete(b.id)
                                    : next.add(b.id);
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
                        key={i}
                        px={3}
                        py={2}
                        bg="bg.muted"
                        borderRadius="md"
                        fontSize="sm"
                        opacity={0.7}
                      >
                        <Badge colorPalette={roleBadgeColor(b.role)} size="sm">
                          {b.customRoleName ?? b.role}
                        </Badge>
                        <Text color="fg.muted">on</Text>
                        <Badge colorPalette="purple" size="sm">
                          {scopeTypeLabel(b.scopeType)}{" "}
                          {b.scopeName ?? b.scopeId}
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
                />
              </Box>
            )}

            {/* Group access */}
            <Box>
              <Text fontSize="sm" fontWeight="semibold" mb={3}>
                Group access
              </Text>
              {memberGroups.isLoading ? (
                <Spinner size="sm" />
              ) : !memberGroups.data?.length ? (
                <Text fontSize="sm" color="fg.muted" fontStyle="italic">
                  Not a member of any groups.
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
                        <Text fontSize="sm" color="fg.muted">
                          {group.name}
                        </Text>
                        <Link
                          href="/settings/groups"
                          fontSize="xs"
                          color="blue.400"
                        >
                          No access configured
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
                          <Badge
                            colorPalette={roleBadgeColor(b.role)}
                            size="sm"
                          >
                            {b.customRoleName ?? b.role}
                          </Badge>
                          <Text color="fg.muted">on</Text>
                          <Badge colorPalette="purple" size="sm">
                            {scopeTypeLabel(b.scopeType)} {b.scopeName ?? "—"}
                          </Badge>
                          <Spacer />
                          <Text fontSize="xs" color="fg.muted">
                            via {group.name}
                          </Text>
                        </HStack>
                      ))
                    ),
                  )}
                </VStack>
              )}
            </Box>
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
