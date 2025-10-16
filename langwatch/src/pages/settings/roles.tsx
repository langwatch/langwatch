import {
  Box,
  Button,
  Card,
  Field,
  Fieldset,
  Heading,
  HStack,
  Input,
  Separator,
  Spinner,
  Text,
  Textarea,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import { Edit, Eye, Info, Plus, Shield, Trash2 } from "react-feather";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog } from "../../components/ui/dialog";
import { Tooltip } from "../../components/ui/tooltip";
import { toaster } from "../../components/ui/toaster";
import SettingsLayout from "../../components/SettingsLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import type { Permission, Resource, Action } from "../../server/api/rbac";
import { Resources, Actions } from "../../server/api/rbac";

/**
 * Role Management Settings Page
 *
 * Single Responsibility: Allows organization admins to create and manage custom roles
 * with granular permission assignments.
 */
export default function RolesSettings() {
  const { organization } = useOrganizationTeamProject();

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
      <RolesManagement organizationId={organization.id} />
    </SettingsLayout>
  );
}

type RoleFormData = {
  name: string;
  description: string;
  permissions: Permission[];
};

function RolesManagement({ organizationId }: { organizationId: string }) {
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
    } catch (error) {
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
    } catch (error) {
      toaster.create({
        title: "Failed to load role",
        description: "Could not load role details for viewing",
        type: "error",
      });
    }
  };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
    setValue,
    watch,
  } = useForm<RoleFormData>({
    defaultValues: {
      name: "",
      description: "",
      permissions: [],
    },
  });

  const {
    register: registerEdit,
    handleSubmit: handleEditSubmit,
    reset: resetEdit,
    formState: { errors: editErrors, isSubmitting: isEditSubmitting },
    setValue: setEditValue,
    watch: watchEdit,
  } = useForm<RoleFormData>({
    defaultValues: {
      name: "",
      description: "",
      permissions: [],
    },
  });

  const selectedPermissions = watch("permissions") || [];
  const selectedEditPermissions = watchEdit("permissions") || [];

  const onSubmit = handleSubmit(async (data) => {
    await createRole.mutateAsync({
      organizationId,
      name: data.name,
      description: data.description,
      permissions: data.permissions,
    });
    reset();
  });

  const onEditSubmit = handleEditSubmit(async (data) => {
    if (!editingRole) return;
    await updateRole.mutateAsync({
      roleId: editingRole.id,
      name: data.name,
      description: data.description,
      permissions: data.permissions,
    });
    resetEdit();
  });

  // Update edit form when editingRole changes
  useEffect(() => {
    if (editingRole) {
      setEditValue("name", editingRole.name);
      setEditValue("description", editingRole.description);
      setEditValue("permissions", editingRole.permissions);
    }
  }, [editingRole, setEditValue]);

  return (
    <VStack
      align="start"
      width="full"
      paddingX={4}
      paddingY={6}
      gap={6}
      maxWidth="1200px"
    >
      <HStack justify="space-between" width="full">
        <VStack align="start" gap={1}>
          <Heading size="lg">Roles & Permissions</Heading>
          <Text color="gray.600" fontSize="sm">
            Create custom roles and assign specific permissions to control
            access
          </Text>
        </VStack>
        <Button colorPalette="orange" onClick={onOpen}>
          <Plus size={16} /> Create Role
        </Button>
      </HStack>

      <Separator />

      {/* Default Roles */}
      <VStack align="start" width="full" gap={4}>
        <Heading size="md">Default Roles</Heading>
        <Text color="gray.600" fontSize="sm">
          These are the built-in roles that cannot be modified or deleted.
        </Text>

        <Box
          width="full"
          display="grid"
          gridTemplateColumns="repeat(auto-fit, minmax(300px, 1fr))"
          gap={4}
        >
          <RoleCard
            name="Admin"
            description="Full access to all features and settings"
            isDefault
            permissionCount="All Permissions"
          />
          <RoleCard
            name="Member"
            description="Can create and modify most resources, view costs and debug info"
            isDefault
            permissionCount="Most Permissions"
          />
          <RoleCard
            name="Viewer"
            description="Read-only access to analytics, messages, and guardrails"
            isDefault
            permissionCount="View Only"
          />
        </Box>
      </VStack>

      <Separator />

      {/* Custom Roles */}
      <VStack align="start" width="full" gap={4}>
        <Heading size="md">Custom Roles</Heading>
        <Text color="gray.600" fontSize="sm">
          Custom roles created for your organization with specific permission
          sets.
        </Text>

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
      <Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose()}>
        <Dialog.Backdrop />
        <Dialog.Content maxWidth="900px" maxHeight="90vh" overflowY="auto">
          <Dialog.Header>
            <Dialog.Title>Create Custom Role</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <form
              id="create-role-form"
              onSubmit={(e) => {
                void onSubmit(e);
              }}
            >
              <VStack gap={6} align="start">
                <Field.Root invalid={!!errors.name}>
                  <Field.Label>
                    Role Name{" "}
                    <Text as="span" color="red.500">
                      *
                    </Text>
                  </Field.Label>
                  <Input
                    {...register("name", {
                      required: "Role name is required",
                    })}
                    placeholder="e.g., Data Analyst"
                  />
                  {errors.name && (
                    <Field.ErrorText>{errors.name.message}</Field.ErrorText>
                  )}
                </Field.Root>

                <Field.Root>
                  <Field.Label>Description</Field.Label>
                  <Field.HelperText>
                    Describe what this role is for
                  </Field.HelperText>
                  <Textarea
                    {...register("description")}
                    placeholder="e.g., Can view and analyze data but cannot modify settings"
                    rows={3}
                  />
                </Field.Root>

                <Separator />

                <VStack align="start" width="full" gap={4}>
                  <Heading size="sm">Permissions</Heading>
                  <Text fontSize="sm" color="gray.600">
                    Select the permissions this role should have
                  </Text>

                  <PermissionSelector
                    selectedPermissions={selectedPermissions}
                    onChange={(permissions) =>
                      setValue("permissions", permissions)
                    }
                  />
                </VStack>
              </VStack>
            </form>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-role-form"
              colorPalette="orange"
              loading={isSubmitting}
            >
              Create Role
            </Button>
          </Dialog.Footer>
          <Dialog.CloseTrigger />
        </Dialog.Content>
      </Dialog.Root>

      {/* Edit Role Dialog */}
      <Dialog.Root
        open={editOpen}
        onOpenChange={({ open }) => !open && onEditClose()}
      >
        <Dialog.Backdrop />
        <Dialog.Content maxWidth="900px" maxHeight="90vh" overflowY="auto">
          <Dialog.Header>
            <Dialog.Title>Edit Role</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <form
              id="edit-role-form"
              onSubmit={(e) => {
                void onEditSubmit(e);
              }}
            >
              <VStack gap={6} align="start">
                <Field.Root invalid={!!editErrors.name}>
                  <Field.Label>
                    Role Name{" "}
                    <Text as="span" color="red.500">
                      *
                    </Text>
                  </Field.Label>
                  <Input
                    {...registerEdit("name", {
                      required: "Role name is required",
                    })}
                    placeholder="e.g., Data Analyst"
                  />
                  {editErrors.name && (
                    <Field.ErrorText>{editErrors.name.message}</Field.ErrorText>
                  )}
                </Field.Root>

                <Field.Root>
                  <Field.Label>Description</Field.Label>
                  <Field.HelperText>
                    Describe what this role is for
                  </Field.HelperText>
                  <Textarea
                    {...registerEdit("description")}
                    placeholder="e.g., Can view and analyze data but cannot modify settings"
                    rows={3}
                  />
                </Field.Root>

                <Separator />

                <VStack align="start" width="full" gap={4}>
                  <Heading size="sm">Permissions</Heading>
                  <Text fontSize="sm" color="gray.600">
                    Select the permissions this role should have
                  </Text>

                  <PermissionSelector
                    selectedPermissions={selectedEditPermissions}
                    onChange={(permissions) =>
                      setEditValue("permissions", permissions)
                    }
                  />
                </VStack>
              </VStack>
            </form>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="outline" onClick={onEditClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="edit-role-form"
              colorPalette="orange"
              loading={isEditSubmitting}
            >
              Update Role
            </Button>
          </Dialog.Footer>
          <Dialog.CloseTrigger />
        </Dialog.Content>
      </Dialog.Root>

      {/* View Permissions Dialog */}
      <Dialog.Root
        open={viewOpen}
        onOpenChange={({ open }) => !open && onViewClose()}
      >
        <Dialog.Backdrop />
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
    </VStack>
  );
}

function RoleCard({
  name,
  description,
  permissionCount,
  isDefault = false,
  onDelete,
  onEdit,
  onViewPermissions,
}: {
  name: string;
  description: string;
  permissionCount: string;
  isDefault?: boolean;
  onDelete?: () => void;
  onEdit?: () => void;
  onViewPermissions?: () => void;
}) {
  return (
    <Card.Root
      width="100%"
      height="100%"
      borderWidth="1px"
      borderColor="gray.200"
      _hover={{ borderColor: "orange.400", shadow: "md" }}
      transition="all 0.2s"
      display="flex"
      flexDirection="column"
    >
      <Card.Header>
        <HStack justify="space-between" align="start">
          <VStack align="start" gap={1} flex={1}>
            <HStack>
              <Shield size={18} />
              <Text fontWeight="semibold">{name}</Text>
            </HStack>
            {isDefault && (
              <Text fontSize="xs" color="gray.500">
                Built-in Role
              </Text>
            )}
          </VStack>
          {!isDefault && (
            <HStack gap={1}>
              {onViewPermissions && (
                <Button
                  size="sm"
                  variant="ghost"
                  colorPalette="blue"
                  onClick={onViewPermissions}
                >
                  <Eye size={14} />
                </Button>
              )}
              {onEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  colorPalette="orange"
                  onClick={onEdit}
                >
                  <Edit size={14} />
                </Button>
              )}
              {onDelete && (
                <Button
                  size="sm"
                  variant="ghost"
                  colorPalette="red"
                  onClick={onDelete}
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </HStack>
          )}
        </HStack>
      </Card.Header>
      <Card.Body paddingTop={0} flex={1} display="flex" flexDirection="column">
        <VStack align="start" gap={2} flex={1}>
          <Text fontSize="sm" color="gray.600">
            {description}
          </Text>
          <Text fontSize="xs" color="orange.600" fontWeight="medium">
            {permissionCount}
          </Text>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

function PermissionSelector({
  selectedPermissions,
  onChange,
}: {
  selectedPermissions: Permission[];
  onChange: (permissions: Permission[]) => void;
}) {
  // Helper function to safely create permission strings
  const createPermission = (resource: Resource, action: Action): Permission => {
    return `${resource}:${action}`;
  };
  const groupedPermissions: Record<Resource, Permission[]> = {} as Record<
    Resource,
    Permission[]
  >;

  // Define which actions are valid for each resource
  const getValidActionsForResource = (resource: Resource): Action[] => {
    // Cost resource only has view permission
    if (resource === Resources.COST) {
      return [Actions.VIEW];
    }
    // Messages only have view and share permissions
    if (resource === Resources.MESSAGES) {
      return [Actions.VIEW, Actions.SHARE];
    }
    // Scenarios only have view permission
    if (resource === Resources.SCENARIOS) {
      return [Actions.VIEW];
    }
    // Most other resources don't have share
    return [
      Actions.MANAGE,
      Actions.VIEW,
      Actions.CREATE,
      Actions.UPDATE,
      Actions.DELETE,
    ];
  };

  // Define the order of resources - this is the single source of truth for UI ordering
  const resourceOrder: Resource[] = [
    Resources.ORGANIZATION,
    Resources.PROJECT,
    Resources.TEAM,
    Resources.ANALYTICS,
    Resources.COST,
    Resources.MESSAGES,
    Resources.SCENARIOS,
    Resources.ANNOTATIONS,
    Resources.GUARDRAILS,
    Resources.EXPERIMENTS,
    Resources.DATASETS,
    Resources.TRIGGERS,
    Resources.WORKFLOWS,
    Resources.PROMPTS,
    // Resources.PLAYGROUND, // Hidden
  ];

  // Group permissions by resource using the correct valid actions
  resourceOrder.forEach((resource) => {
    const validActions = getValidActionsForResource(resource);
    groupedPermissions[resource] = validActions.map((action) =>
      createPermission(resource, action),
    );
  });

  const togglePermission = (permission: Permission) => {
    if (selectedPermissions.includes(permission)) {
      // If removing a permission, remove it and any dependent permissions
      let permissionsToRemove = [permission];

      // If removing manage, also remove all other permissions for this resource
      if (permission.endsWith(":manage")) {
        const resource = permission.split(":")[0] as Resource;
        const resourcePermissions = groupedPermissions[resource] || [];
        permissionsToRemove = resourcePermissions;
      }

      onChange(
        selectedPermissions.filter((p) => !permissionsToRemove.includes(p)),
      );
    } else {
      // If adding a permission, add it and handle hierarchy
      let permissionsToAdd = [permission];

      // If adding manage, add all permissions for this resource
      if (permission.endsWith(":manage")) {
        const resource = permission.split(":")[0] as Resource;
        const resourcePermissions = groupedPermissions[resource] || [];
        permissionsToAdd = resourcePermissions;
      }

      // Add all permissions that aren't already selected
      const newPermissions = [
        ...selectedPermissions,
        ...permissionsToAdd.filter((p) => !selectedPermissions.includes(p)),
      ];
      onChange(newPermissions);
    }
  };

  return (
    <VStack align="start" width="full" gap={4}>
      {(Object.keys(groupedPermissions) as Resource[]).map((resource) => {
        const validActions = getValidActionsForResource(resource);

        return (
          <Box key={resource} width="full">
            <Fieldset.Root>
              <Fieldset.Legend
                fontSize="sm"
                fontWeight="semibold"
                textTransform="capitalize"
                marginBottom={2}
              >
                <Text>{resource}</Text>
              </Fieldset.Legend>
              <Fieldset.Content>
                <HStack gap={4} flexWrap="wrap" paddingLeft={6}>
                  {validActions.map((action) => {
                    const permission = createPermission(resource, action);
                    const isChecked = selectedPermissions.includes(permission);

                    // Check if this permission is implicitly checked due to manage being selected
                    const managePermission = createPermission(
                      resource,
                      "manage",
                    );
                    const isImplicitlyChecked =
                      action !== "manage" &&
                      selectedPermissions.includes(managePermission);

                    return (
                      <Checkbox
                        key={permission}
                        checked={isChecked || isImplicitlyChecked}
                        onChange={() => togglePermission(permission)}
                        disabled={isImplicitlyChecked}
                        opacity={isImplicitlyChecked ? 0.6 : 1}
                      >
                        {action === "manage" ? (
                          <Tooltip
                            content="Manage includes all permissions (view, create, update, delete) for this resource"
                            positioning={{ placement: "top" }}
                            showArrow
                          >
                            <HStack gap={1}>
                              <Text fontSize="sm" textTransform="capitalize">
                                {action}
                              </Text>
                              <Box color="gray.500">
                                <Info size={14} />
                              </Box>
                            </HStack>
                          </Tooltip>
                        ) : (
                          <Text fontSize="sm" textTransform="capitalize">
                            {action}
                          </Text>
                        )}
                      </Checkbox>
                    );
                  })}
                </HStack>
              </Fieldset.Content>
            </Fieldset.Root>
            <Separator marginY={3} />
          </Box>
        );
      })}
    </VStack>
  );
}

/**
 * PermissionViewer component
 *
 * Single Responsibility: Displays permissions in a read-only, organized format
 */
function PermissionViewer({ permissions }: { permissions: Permission[] }) {
  // Helper function to safely create permission strings
  const createPermission = (resource: Resource, action: Action): Permission => {
    return `${resource}:${action}`;
  };

  const groupedPermissions: Record<Resource, Permission[]> = {} as Record<
    Resource,
    Permission[]
  >;

  // Define the order of resources - this is the single source of truth for UI ordering
  const resourceOrder: Resource[] = [
    Resources.ORGANIZATION,
    Resources.PROJECT,
    Resources.TEAM,
    Resources.ANALYTICS,
    Resources.COST,
    Resources.MESSAGES,
    Resources.SCENARIOS,
    Resources.ANNOTATIONS,
    Resources.GUARDRAILS,
    Resources.EXPERIMENTS,
    Resources.DATASETS,
    Resources.TRIGGERS,
    Resources.WORKFLOWS,
    Resources.PROMPTS,
    Resources.PLAYGROUND,
  ];

  // Group permissions by resource
  resourceOrder.forEach((resource) => {
    groupedPermissions[resource] = Object.values(Actions).map((action) =>
      createPermission(resource, action),
    );
  });

  // Define which actions are valid for each resource
  const getValidActionsForResource = (resource: Resource): Action[] => {
    // Cost resource only has view permission
    if (resource === Resources.COST) {
      return [Actions.VIEW];
    }
    // Messages only have view and share permissions
    if (resource === Resources.MESSAGES) {
      return [Actions.VIEW, Actions.SHARE];
    }
    // Scenarios only have view permission
    if (resource === Resources.SCENARIOS) {
      return [Actions.VIEW];
    }
    // Most other resources don't have share
    return [
      Actions.VIEW,
      Actions.CREATE,
      Actions.UPDATE,
      Actions.DELETE,
      Actions.MANAGE,
    ];
  };

  return (
    <VStack align="start" width="full" gap={3}>
      {(Object.keys(groupedPermissions) as Resource[]).map((resource) => {
        const validActions = getValidActionsForResource(resource);
        const hasAnyPermission = validActions.some((action) =>
          permissions.includes(`${resource}:${action}`),
        );

        if (!hasAnyPermission) return null;

        return (
          <Box key={resource} width="full">
            <VStack align="start" gap={2} width="full">
              <Text fontWeight="semibold" textTransform="capitalize">
                {resource}
              </Text>
              <HStack gap={3} flexWrap="wrap" paddingLeft={4}>
                {validActions.map((action) => {
                  const permission = createPermission(resource, action);
                  const hasPermission = permissions.includes(permission);

                  if (!hasPermission) return null;

                  return (
                    <Text
                      key={permission}
                      fontSize="sm"
                      textTransform="capitalize"
                      color="green.600"
                      fontWeight="medium"
                    >
                      {action}
                    </Text>
                  );
                })}
              </HStack>
            </VStack>
            <Separator marginY={2} />
          </Box>
        );
      })}
    </VStack>
  );
}
