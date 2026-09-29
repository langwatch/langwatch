// Roles screen; three-state plan gate; grant asked twice for future reuse.

import {
  Alert,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Separator,
  Spacer,
  Spinner,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { Link } from "@langwatch/browser-host/link";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Dialog } from "@langwatch/design-system/dialog";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useState } from "react";
import { Plus, Shield } from "react-feather";

import { authzApi } from "../../behavior/authz-api.ts";
import {
  AUTHZ_MANAGE_PERMISSION,
  type AuthzHostApi,
  useAuthzHost,
} from "../../model/authz-host.ts";
import {
  BUILTIN_ROLE_CARDS,
  builtinRoleGrantedPermissions,
  peopleHoldingBuiltinRole,
} from "../../model/builtin-roles.ts";
import { BuiltinRoleCardView } from "../blocks/builtin-role-card.tsx";
import { PermissionViewer } from "../blocks/permission-viewer.tsx";
import { RoleCard } from "../blocks/role-card.tsx";
import { EnterpriseUpsell } from "../elements/enterprise-upsell.tsx";
import { RoleFormDialog, type RoleFormData } from "./role-form-dialog.tsx";
import { RolesTabs } from "./roles-tabs.tsx";

// Permission list cast; wire carries strings; registry filters unrecognised.
function asPermissions(permissions: readonly string[]): AuthzPermission[] {
  return permissions as AuthzPermission[];
}

/** One role being looked at or edited, as the two dialogs hold it. */
type RoleDetail = {
  id: string;
  name: string;
  description: string;
  permissions: AuthzPermission[];
};

export default function RolesScreen() {
  const host = useAuthzHost();
  const { organizationId } = host.scope();
  const { isEnterprise, isLoading: isPlanLoading } = host.plan();

  if (!organizationId || isPlanLoading) {
    return (
      <VStack align="center" justify="center" width="full" height="200px">
        <Spinner />
      </VStack>
    );
  }

  if (!isEnterprise) {
    return (
      <VStack gap={6} width="full" align="start">
        <Alert.Root status="info">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Enterprise Feature</Alert.Title>
            <Alert.Description>
              Custom roles are available on Enterprise plans. Contact sales to upgrade.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
        <EnterpriseUpsell />
      </VStack>
    );
  }

  return (
    <RolesTabs
      host={host}
      organizationId={organizationId}
      roles={<RolesManagement organizationId={organizationId} host={host} />}
    />
  );
}

function RolesManagement({ organizationId, host }: { organizationId: string; host: AuthzHostApi }) {
  const { open, onOpen, onClose } = useDisclosure();
  const { open: editOpen, onOpen: onEditOpen, onClose: onEditClose } = useDisclosure();
  const { open: viewOpen, onOpen: onViewOpen, onClose: onViewClose } = useDisclosure();
  const {
    open: defaultViewOpen,
    onOpen: onDefaultViewOpen,
    onClose: onDefaultViewClose,
  } = useDisclosure();

  const [editingRole, setEditingRole] = useState<RoleDetail | null>(null);
  const [viewingRole, setViewingRole] = useState<RoleDetail | null>(null);
  const [viewingBuiltinRole, setViewingBuiltinRole] = useState<{
    name: string;
    description: string;
    permissions: AuthzPermission[];
  } | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<{ id: string; name: string } | null>(null);

  const canManage = host.hasPermission(AUTHZ_MANAGE_PERMISSION);
  const utils = authzApi.useUtils();
  const roles = authzApi.role.getAll.useQuery({ organizationId });
  const bindings = authzApi.roleBinding.listForOrg.useQuery(
    { organizationId },
    { enabled: !!organizationId },
  );
  const canReadAuditLog = host.hasPermission("auditLog:view");

  const createRole = authzApi.role.create.useMutation({
    onSuccess: () => {
      void utils.role.getAll.invalidate();
      host.succeeded({ title: "Role created successfully" });
      onClose();
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't create role" }),
  });

  const deleteRole = authzApi.role.delete.useMutation({
    onSuccess: () => {
      void utils.role.getAll.invalidate();
      host.succeeded({ title: "Role deleted successfully" });
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't delete role" }),
  });

  const updateRole = authzApi.role.update.useMutation({
    onSuccess: () => {
      void utils.role.getAll.invalidate();
      host.succeeded({ title: "Role updated successfully" });
      onEditClose();
      setEditingRole(null);
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't update role" }),
  });

  const readRole = async (roleId: string): Promise<RoleDetail | null> => {
    try {
      const role = await utils.role.getById.fetch({ roleId });
      return {
        id: role.id,
        name: role.name,
        description: role.description ?? "",
        permissions: asPermissions(role.permissions),
      };
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't load role details" });
      return null;
    }
  };

  const handleEditRole = async (roleId: string) => {
    const role = await readRole(roleId);
    if (!role) return;
    setEditingRole(role);
    onEditOpen();
  };

  const handleViewPermissions = async (roleId: string) => {
    const role = await readRole(roleId);
    if (!role) return;
    setViewingRole(role);
    onViewOpen();
  };

  const handleViewBuiltinRole = (card: (typeof BUILTIN_ROLE_CARDS)[number]) => {
    setViewingBuiltinRole({
      name: card.name,
      description: card.description,
      permissions: builtinRoleGrantedPermissions(card.teamRole),
    });
    onDefaultViewOpen();
  };

  const handleCreateSubmit = async (data: RoleFormData) => {
    await createRole.mutateAsync({
      organizationId,
      name: data.name,
      description: data.description,
      permissions: data.permissions,
    });
  };

  const handleEditSubmit = async (data: RoleFormData) => {
    if (!editingRole) return;
    await updateRole.mutateAsync({
      roleId: editingRole.id,
      name: data.name,
      description: data.description,
      permissions: data.permissions,
    });
  };

  return (
    <VStack align="start" width="full" gap={6}>
      <VStack align="start" width="full" gap={4}>
        <Box>
          <Heading as="h3">Predefined roles</Heading>
          <Text color="fg.muted" fontSize="sm">
            Three roles cover most teams. They cannot be changed or deleted.
          </Text>
        </Box>

        <Box
          width="full"
          display="grid"
          gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))"
          gap={4}
        >
          {BUILTIN_ROLE_CARDS.map((card) => (
            <BuiltinRoleCardView
              key={card.teamRole}
              card={card}
              people={
                bindings.data
                  ? peopleHoldingBuiltinRole({ bindings: bindings.data, teamRole: card.teamRole })
                  : null
              }
              totalPermissions={builtinRoleGrantedPermissions(card.teamRole).length}
              onOpenDetail={() => handleViewBuiltinRole(card)}
            />
          ))}
        </Box>
      </VStack>

      <Separator />

      <VStack align="start" width="full" gap={4}>
        <HStack width="full" align="start">
          <Box>
            <Heading as="h3">Custom roles</Heading>
            <Text color="fg.muted" fontSize="sm">
              Scoped grants for people who need one thing and nothing else.
            </Text>
          </Box>
          <Spacer />
          <Tooltip
            content="You need permission to manage this organization to write a role."
            disabled={canManage}
          >
            <PageLayout.HeaderButton
              onClick={onOpen}
              disabled={!canManage}
              data-testid="authz-role-create"
            >
              <Plus size={16} /> New role
            </PageLayout.HeaderButton>
          </Tooltip>
        </HStack>

        {roles.isLoading && (
          <VStack align="center" width="full" padding={8}>
            <Spinner />
          </VStack>
        )}

        {roles.data && roles.data.length === 0 && (
          <Card.Root width="full">
            <Card.Body textAlign="center" padding={8}>
              <VStack gap={2}>
                <Shield size={48} color="gray" />
                <Text color="fg.muted">
                  No custom roles yet. Create your first custom role to get started.
                </Text>
              </VStack>
            </Card.Body>
          </Card.Root>
        )}

        <Box
          width="full"
          display="grid"
          gridTemplateColumns="repeat(auto-fit, minmax(300px, 1fr))"
          gap={4}
        >
          {roles.data?.map((role) => (
            <RoleCard
              key={role.id}
              name={role.name}
              description={role.description ?? ""}
              permissionCount={`${role.permissions.length} permissions`}
              hasPermission={(permission) => host.hasPermission(permission)}
              onDelete={() => setRoleToDelete({ id: role.id, name: role.name })}
              onEdit={() => {
                void handleEditRole(role.id);
              }}
              onViewPermissions={() => {
                void handleViewPermissions(role.id);
              }}
            />
          ))}
        </Box>

        {canReadAuditLog && (
          <Text fontSize="xs" color="fg.muted">
            Every role you write, change or hand to somebody is recorded in the{" "}
            <Link href="/settings/audit-log" fontSize="xs">
              audit log
            </Link>
            .
          </Text>
        )}
      </VStack>

      <RoleFormDialog
        open={open}
        onClose={onClose}
        onSubmit={handleCreateSubmit}
        title="Create Custom Role"
        submitLabel="Create Role"
        isSubmitting={createRole.isPending}
      />

      <RoleFormDialog
        open={editOpen}
        onClose={() => {
          onEditClose();
          setEditingRole(null);
        }}
        onSubmit={handleEditSubmit}
        {...(editingRole
          ? {
              initialData: {
                name: editingRole.name,
                description: editingRole.description,
                permissions: editingRole.permissions,
              },
            }
          : {})}
        title="Edit Role"
        submitLabel="Update Role"
        isSubmitting={updateRole.isPending}
      />

      <ConfirmDialog
        open={!!roleToDelete}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRoleToDelete(null);
        }}
        title="Delete role"
        message={`Are you sure you want to delete the role "${roleToDelete?.name ?? ""}"?`}
        confirmLabel="Delete"
        tone="danger"
        loading={deleteRole.isPending}
        onConfirm={() => {
          if (!roleToDelete) return;
          deleteRole.mutate(
            { roleId: roleToDelete.id },
            { onSettled: () => setRoleToDelete(null) },
          );
        }}
      />

      <PermissionsDialog
        open={viewOpen}
        onClose={onViewClose}
        name={viewingRole?.name}
        description={viewingRole?.description}
        permissions={viewingRole?.permissions}
        emptyDescription="No description provided"
      />

      <PermissionsDialog
        open={defaultViewOpen}
        onClose={onDefaultViewClose}
        name={viewingBuiltinRole?.name}
        description={viewingBuiltinRole?.description}
        permissions={viewingBuiltinRole?.permissions}
      />
    </VStack>
  );
}

// Read-only permissions dialog; one component for both; fallback only difference.
function PermissionsDialog({
  open,
  onClose,
  name,
  description,
  permissions,
  emptyDescription,
}: {
  open: boolean;
  onClose: () => void;
  name: string | undefined;
  description: string | undefined;
  permissions: readonly AuthzPermission[] | undefined;
  emptyDescription?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={({ open: isOpen }) => !isOpen && onClose()}>
      <Dialog.Content bg="bg" maxWidth="600px" maxHeight="80vh" overflowY="auto">
        <Dialog.Header>
          <Dialog.Title>View Permissions - {name}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          {permissions && (
            <VStack gap={4} align="start">
              <VStack align="start" gap={2} width="full">
                <Text fontWeight="semibold">Description:</Text>
                <Text color="fg.muted">{description || emptyDescription || ""}</Text>
              </VStack>

              <Separator />

              <VStack align="start" gap={3} width="full">
                <Text fontWeight="semibold">Permissions ({permissions.length}):</Text>
                <PermissionViewer permissions={permissions} />
              </VStack>
            </VStack>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </Dialog.Footer>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}
