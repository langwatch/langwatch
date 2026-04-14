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
import { RoleBindingScopeType } from "@prisma/client";
import { X } from "lucide-react";
import { Link } from "~/components/ui/link";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";
import {
  BindingInputRow,
  roleBadgeColor,
  scopeTypeLabel,
  type BindingInputRowHandle,
  type PendingBinding,
} from "./GroupBindingInputRow";

type MemberSummary = {
  userId: string;
  user: { name: string | null; email: string | null };
};

export function MemberDetailDialog({
  member,
  organizationId,
  canManage,
  open,
  onClose,
}: {
  member: MemberSummary;
  organizationId: string;
  canManage: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = api.useContext();

  const [pendingBindingRemovals, setPendingBindingRemovals] = useState<Set<string>>(new Set());
  const [pendingBindingAdditions, setPendingBindingAdditions] = useState<PendingBinding[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const bindingInputRef = useRef<BindingInputRowHandle>(null);

  const reset = () => {
    setPendingBindingRemovals(new Set());
    setPendingBindingAdditions([]);
  };

  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, member.userId]);

  const directBindings = api.roleBinding.listForOrg.useQuery(
    { organizationId },
    { enabled: open && canManage },
  );
  const memberGroups = api.group.listForMember.useQuery(
    { organizationId, userId: member.userId },
    { enabled: open },
  );

  const createBinding = api.roleBinding.create.useMutation();
  const deleteBinding = api.roleBinding.delete.useMutation();

  const hasChanges =
    pendingBindingRemovals.size > 0 ||
    pendingBindingAdditions.length > 0;

  const handleSave = async () => {
    // Auto-stage any uncommitted binding row (user selected fields but didn't click Add)
    const uncommitted = bindingInputRef.current?.flush() ?? null;
    const allBindingAdditions = uncommitted
      ? [...pendingBindingAdditions, uncommitted]
      : pendingBindingAdditions;

    setIsSaving(true);
    try {
      await Promise.all([
        ...[...pendingBindingRemovals].map((bindingId) =>
          deleteBinding.mutateAsync({ organizationId, bindingId }),
        ),
        ...allBindingAdditions.map((b) =>
          createBinding.mutateAsync({
            organizationId,
            userId: member.userId,
            role: b.role as any,
            customRoleId: b.customRoleId,
            scopeType: b.scopeType,
            scopeId: b.scopeId,
          }),
        ),
      ]);

      void queryClient.roleBinding.listForOrg.invalidate();
      void queryClient.organization.getOrganizationWithMembersAndTheirTeams.invalidate();
      void queryClient.organization.getAll.invalidate();
      toaster.create({ title: "Member updated", type: "success" });
      onClose();
    } catch (e: any) {
      toaster.create({ title: e?.message ?? "Failed to save", type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  const userDirectBindings = (directBindings.data ?? []).filter(
    (b) => b.userId === member.userId,
  );

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
      <Dialog.Content maxHeight="90vh" overflowY="auto">
        <Dialog.Header>
          <Dialog.Title>{member.user.name ?? member.user.email}</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body pb={6}>
          <VStack gap={5} align="stretch">
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
                            textDecoration={markedForRemoval ? "line-through" : undefined}
                          >
                            {b.customRoleName ?? b.role}
                          </Badge>
                          <Text color="fg.muted">on</Text>
                          <Badge
                            colorPalette="purple"
                            size="sm"
                            textDecoration={markedForRemoval ? "line-through" : undefined}
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
                              aria-label={markedForRemoval ? "Undo removal" : "Remove binding"}
                              onClick={() =>
                                setPendingBindingRemovals((prev) => {
                                  const next = new Set(prev);
                                  next.has(b.id) ? next.delete(b.id) : next.add(b.id);
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
                          {scopeTypeLabel(b.scopeType)} {b.scopeName ?? b.scopeId}
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
                  onAdd={(b) =>
                    setPendingBindingAdditions((prev) => [...prev, b])
                  }
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
                        <Link href="/settings/groups" fontSize="xs" color="blue.400">
                          No access configured
                        </Link>
                      </HStack>
                    ) : group.bindings.map((b) => (
                      <HStack
                        key={b.id}
                        px={3}
                        py={2}
                        bg="bg.muted"
                        borderRadius="md"
                        fontSize="sm"
                      >
                        <Badge colorPalette={roleBadgeColor(b.role)} size="sm">
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
