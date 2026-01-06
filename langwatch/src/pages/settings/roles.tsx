import {
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
import { TeamUserRole } from "@prisma/client";
import { ShieldUser } from "lucide-react";

import { useState } from "react";
import { Eye, Plus, Shield, Users } from "react-feather";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import SettingsLayout from "../../components/SettingsLayout";
import { PermissionViewer } from "../../components/settings/PermissionViewer";
import { RoleCard } from "../../components/settings/RoleCard";
import { RoleFormDialog } from "../../components/settings/RoleFormDialog";
import { Dialog } from "../../components/ui/dialog";
import { toaster } from "../../components/ui/toaster";
import { Tooltip } from "../../components/ui/tooltip";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { Permission } from "../../server/api/rbac";
import { getTeamRolePermissions } from "../../server/api/rbac";
import { api } from "../../utils/api";

/**
 * Role Management Settings Page
 *
 * Single Responsibility: Allows organization admins to create and manage custom roles
 * with granular permission assignments.
 */
function RolesSettings() {
  const { organization, hasPermission } = useOrganizationTeamProject();

  if (!organization) {
    return (
      <SettingsLayout>
        <VStack align="center" justify="center" width="full" height="200px">
          <Spinner />
        </VStack>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout>
      <RolesManagement
        organizationId={organization.id}
        hasPermission={hasPermission}
      />
    </SettingsLayout>
  );
}

export default withPermissionGuard("organization:view", {
  layoutComponent: SettingsLayout,
})(RolesSettings);

type RoleFormData = {
  name: string;
  description: string;
  permissions: Permission[];
};

function RolesManagement({
  organizationId,
  hasPermission,
}: {
  organizationId: string;
  hasPermission: (permission: Permission) => boolean;
}) {
  const { open, onOpen, onClose } = useDisclosure();
  const {
    open: editOpen,
    onOpen: onEditOpen,
    onClose: onEditClose,
  } = useDisclosure();
  const {
    open: viewOpen,
    onOpen: onViewOpen,
    onClose: onViewClose,
  } = useDisclosure();
  const {
    open: defaultViewOpen,
    onOpen: onDefaultViewOpen,
    onClose: onDefaultViewClose,
  } = useDisclosure();
  const [editingRole, setEditingRole] = useState<{
    id: string;
    name: string;
    description: string;
    permissions: Permission[];
  } | null>(null);
  const [viewingRole, setViewingRole] = useState<{
    id: string;
    name: string;
    description: string;
    permissions: Permission[];
  } | null>(null);
  const [viewingDefaultRole, setViewingDefaultRole] = useState<{
    name: string;
    description: string;
    permissions: Permission[];
  } | null>(null);
  const apiContext = api.useContext();
  // Fetch custom roles
  const roles = api.role.getAll.useQuery({ organizationId });

  // Mutations
  const createRole = api.role.create.useMutation({
    onSuccess: () => {
      void apiContext.role.getAll.invalidate();
      toaster.create({
        title: "Role created successfully",
        type: "success",
      });
      onClose();
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to create role",
        description: error.message,
        type: "error",
      });
    },
  });

  const deleteRole = api.role.delete.useMutation({
    onSuccess: () => {
      void apiContext.role.getAll.invalidate();
      toaster.create({
        title: "Role deleted successfully",
        type: "success",
      });
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to delete role",
        description: error.message,
        type: "error",
      });
    },
  });

  const updateRole = api.role.update.useMutation({
    onSuccess: () => {
      void apiContext.role.getAll.invalidate();
      toaster.create({
        title: "Role updated successfully",
        type: "success",
      });
      onEditClose();
      setEditingRole(null);
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to update role",
        description: error.message,
        type: "error",
      });
    },
  });

  const handleEditRole = async (roleId: string) => {
    try {
      const role = await apiContext.role.getById.fetch({ roleId });
      setEditingRole({
        id: role.id,
        name: role.name,
        description: role.description ?? "",
        permissions: role.permissions as Permission[],
      });
      onEditOpen();
    } catch {
      toaster.create({
        title: "Failed to load role",
        description: "Could not load role details for editing",
        type: "error",
      });
    }
  };

  const handleViewPermissions = async (roleId: string) => {
    try {
      const role = await apiContext.role.getById.fetch({ roleId });
      setViewingRole({
        id: role.id,
        name: role.name,
        description: role.description ?? "",
        permissions: role.permissions as Permission[],
      });
      onViewOpen();
    } catch {
      toaster.create({
        title: "Failed to load role",
        description: "Could not load role details for viewing",
        type: "error",
      });
    }
  };

  const handleViewDefaultRole = (roleName: string, role: TeamUserRole) => {
    const permissions = getTeamRolePermissions(role);
    setViewingDefaultRole({
      name: roleName,
      description: getDefaultRoleDescription(roleName),
      permissions,
    });
    onDefaultViewOpen();
  };

  const getDefaultRoleDescription = (roleName: string): string => {
    switch (roleName) {
      case "Admin":
        return "Full access to all features and settings";
      case "Member":
        return "Can create and modify most resources, view costs and debug info";
      case "Viewer":
        return "Read-only access to analytics, messages, and guardrails";
      default:
        return "";
    }
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
          <Heading as="h2">Roles & Permissions</Heading>
          <Text color="gray.600" fontSize="sm">
            Create custom roles and assign specific permissions to control
            access
          </Text>
        </VStack>
        <Tooltip
          content="You need organization:manage permissions to create roles."
          disabled={hasPermission("organization:manage")}
        >
          <PageLayout.HeaderButton
            onClick={onOpen}
            disabled={!hasPermission("organization:manage")}
          >
            <Plus size={16} /> Create Role
          </PageLayout.HeaderButton>
        </Tooltip>
      </HStack>

      <Separator />

      {/* Default Roles */}
      <VStack align="start" width="full" gap={4}>
        <Box>
          <Heading as="h3">Default Roles</Heading>
          <Text color="gray.600" fontSize="sm">
            These are the built-in roles that cannot be modified or deleted.
          </Text>
        </Box>

        <Box
          width="full"
          display="grid"
          gridTemplateColumns="repeat(auto-fit, minmax(300px, 1fr))"
          gap={4}
        >
          <RoleCard
            hasPermission={hasPermission}
            name="Admin"
            description="Full access to all features and settings"
            isDefault
            permissionCount="All Permissions"
            icon={ShieldUser}
            onViewPermissions={() =>
              handleViewDefaultRole("Admin", TeamUserRole.ADMIN)
            }
          />
          <RoleCard
            hasPermission={hasPermission}
            name="Member"
            description="Can create and modify most resources, view costs and debug info"
            isDefault
            permissionCount="Most Permissions"
            icon={Users}
            onViewPermissions={() =>
              handleViewDefaultRole("Member", TeamUserRole.MEMBER)
            }
          />
          <RoleCard
            hasPermission={hasPermission}
            name="Viewer"
            description="Read-only access to analytics, messages, and guardrails"
            isDefault
            permissionCount="View Only"
            icon={Eye}
            onViewPermissions={() =>
              handleViewDefaultRole("Viewer", TeamUserRole.VIEWER)
            }
          />
        </Box>
      </VStack>

      <Separator />

      {/* Custom Roles */}
      <VStack align="start" width="full" gap={4}>
        <Box>
          <Heading as="h3">Custom Roles</Heading>
          <Text color="gray.600" fontSize="sm">
            Custom roles created for your organization with specific permission
            sets.
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
                <Text color="gray.600">
                  No custom roles yet. Create your first custom role to get
                  started.
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
              hasPermission={hasPermission}
              onDelete={() => {
                if (
                  confirm(
                    `Are you sure you want to delete the role "${role.name}"?`,
                  )
                ) {
                  deleteRole.mutate({ roleId: role.id });
                }
              }}
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

      {/* Create Role Dialog */}
      <RoleFormDialog
        open={open}
        onClose={onClose}
        onSubmit={handleCreateSubmit}
        title="Create Custom Role"
        submitLabel="Create Role"
        isSubmitting={createRole.isLoading}
      />

      {/* Edit Role Dialog */}
      <RoleFormDialog
        open={editOpen}
        onClose={() => {
          onEditClose();
          setEditingRole(null);
        }}
        onSubmit={handleEditSubmit}
        initialData={
          editingRole
            ? {
                name: editingRole.name,
                description: editingRole.description,
                permissions: editingRole.permissions,
              }
            : undefined
        }
        title="Edit Role"
        submitLabel="Update Role"
        isSubmitting={updateRole.isLoading}
      />

      {/* View Permissions Dialog */}
      <Dialog.Root
        open={viewOpen}
        onOpenChange={({ open }) => !open && onViewClose()}
      >
        <Dialog.Content maxWidth="600px" maxHeight="80vh" overflowY="auto">
          <Dialog.Header>
            <Dialog.Title>View Permissions - {viewingRole?.name}</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            {viewingRole && (
              <VStack gap={4} align="start">
                <VStack align="start" gap={2} width="full">
                  <Text fontWeight="semibold">Description:</Text>
                  <Text color="gray.600">
                    {viewingRole.description || "No description provided"}
                  </Text>
                </VStack>

                <Separator />

                <VStack align="start" gap={3} width="full">
                  <Text fontWeight="semibold">
                    Permissions ({viewingRole.permissions.length}):
                  </Text>
                  <PermissionViewer permissions={viewingRole.permissions} />
                </VStack>
              </VStack>
            )}
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="outline" onClick={onViewClose}>
              Close
            </Button>
          </Dialog.Footer>
          <Dialog.CloseTrigger />
        </Dialog.Content>
      </Dialog.Root>

      {/* View Default Role Permissions Dialog */}
      <Dialog.Root
        open={defaultViewOpen}
        onOpenChange={({ open }) => !open && onDefaultViewClose()}
      >
        <Dialog.Content maxWidth="600px" maxHeight="80vh" overflowY="auto">
          <Dialog.Header>
            <Dialog.Title>
              View Permissions - {viewingDefaultRole?.name}
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            {viewingDefaultRole && (
              <VStack gap={4} align="start">
                <VStack align="start" gap={2} width="full">
                  <Text fontWeight="semibold">Description:</Text>
                  <Text color="gray.600">{viewingDefaultRole.description}</Text>
                </VStack>

                <Separator />

                <VStack align="start" gap={3} width="full">
                  <Text fontWeight="semibold">
                    Permissions ({viewingDefaultRole.permissions.length}):
                  </Text>
                  <PermissionViewer
                    permissions={viewingDefaultRole.permissions}
                  />
                </VStack>
              </VStack>
            )}
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="outline" onClick={onDefaultViewClose}>
              Close
            </Button>
          </Dialog.Footer>
          <Dialog.CloseTrigger />
        </Dialog.Content>
      </Dialog.Root>
    </VStack>
  );
}
