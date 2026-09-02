/**
 * Roles & Permissions — the custom roles an organization has defined, beside
 * the three built-in ones it did not.
 *
 * Moved from `platform/app/src/pages/settings/roles.tsx`. What did NOT come
 * with it: `SettingsLayout` and `withPermissionGuard`, which are the frontend
 * feature's to apply (`apps/ui/src/features/authz/ui/sections/authz-routes.tsx`),
 * and `getTeamRolePermissions` from `~/server/api/rbac`, which is rebuilt on
 * `@langwatch/authz-contract` in `model/builtin-roles.ts`.
 *
 * THE PLAN GATE IS THREE-STATE, and the order it is read in is the policy:
 * still asking renders a spinner, not Enterprise renders the sales block, and
 * only then does the management surface exist at all. Collapsing the first into
 * the second would pitch Enterprise at an Enterprise customer for the length of
 * one round trip.
 *
 * THE GRANT IS ASKED TWICE, on purpose. The route refuses a reader without
 * `organization:manage` outright — that is the guard the frontend feature
 * applies — and every write control asks again, because the same components are
 * what a future read-only view would reuse and a control that is live without
 * the grant is a refusal the reader only discovers after typing.
 */

import {
  Alert,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Separator,
  Spinner,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Dialog } from "@langwatch/design-system/dialog";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { ShieldUser } from "lucide-react";
import { useState } from "react";
import { Eye, Plus, Shield, Users } from "react-feather";
import { authzApi } from "../../behavior/authz-api";
import { AUTHZ_MANAGE_PERMISSION, type AuthzHostPort, useAuthzHost } from "../../model/authz-host";
import { BUILTIN_ROLE_CARDS, builtinRoleGrantedPermissions } from "../../model/builtin-roles";
import { EnterpriseUpsell } from "../../ui/elements/enterprise-upsell";
import { PermissionViewer } from "../../ui/blocks/permission-viewer";
import { RoleCard } from "../../ui/blocks/role-card";
import { RoleFormDialog, type RoleFormData } from "../../ui/sections/role-form-dialog";

/**
 * A stored role's permission list, as the editor reads it.
 *
 * The wire carries `string[]`, because a custom role written before a
 * permission was retired still lists it. Everything downstream filters through
 * the registry-backed catalogue, so an unrecognised string is shown by nothing
 * and offered by nothing — which is the same thing the platform page's
 * `role.permissions as Permission[]` did, said out loud.
 */
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

  return <RolesManagement organizationId={organizationId} host={host} />;
}

function RolesManagement({
  organizationId,
  host,
}: {
  organizationId: string;
  host: AuthzHostPort;
}) {
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
      <HStack justify="space-between" width="full">
        <VStack align="start" gap={1}>
          <Heading as="h2">Roles &amp; Permissions</Heading>
          <Text color="fg.muted" fontSize="sm">
            Create custom roles and assign specific permissions to control access
          </Text>
        </VStack>
        <Tooltip
          content="You need organization:manage permissions to create roles."
          disabled={canManage}
        >
          <PageLayout.HeaderButton onClick={onOpen} disabled={!canManage}>
            <Plus size={16} /> Create Role
          </PageLayout.HeaderButton>
        </Tooltip>
      </HStack>

      <Separator />

      <VStack align="start" width="full" gap={4}>
        <Box>
          <Heading as="h3">Default Roles</Heading>
          <Text color="fg.muted" fontSize="sm">
            These are the built-in roles that cannot be modified or deleted.
          </Text>
        </Box>

        <Box
          width="full"
          display="grid"
          gridTemplateColumns="repeat(auto-fit, minmax(300px, 1fr))"
          gap={4}
        >
          {BUILTIN_ROLE_CARDS.map((card) => (
            <RoleCard
              key={card.teamRole}
              hasPermission={(permission) => host.hasPermission(permission)}
              name={card.name}
              description={card.description}
              isDefault
              permissionCount={card.permissionCount}
              icon={BUILTIN_ROLE_ICONS[card.teamRole]}
              onViewPermissions={() => handleViewBuiltinRole(card)}
            />
          ))}
        </Box>
      </VStack>

      <Separator />

      <VStack align="start" width="full" gap={4}>
        <Box>
          <Heading as="h3">Custom Roles</Heading>
          <Text color="fg.muted" fontSize="sm">
            Custom roles created for your organization with specific permission sets.
          </Text>
        </Box>

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

const BUILTIN_ROLE_ICONS = {
  ADMIN: ShieldUser,
  MEMBER: Users,
  VIEWER: Eye,
} as const;

/**
 * A role's permissions, read-only.
 *
 * ONE COMPONENT FOR BOTH DIALOGS. The platform page carried the same eighty
 * lines of dialog twice — once for a custom role and once for a built-in one —
 * differing only in whether the description fell back to a sentence. That is
 * the sort of duplication where the two copies drift, and the fallback is the
 * only thing that ever differed.
 */
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
