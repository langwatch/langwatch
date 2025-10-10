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
import { Plus, Shield, Trash2 } from "react-feather";
import { useForm } from "react-hook-form";
import { useEffect, useRef } from "react";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog } from "../../components/ui/dialog";
import { toaster } from "../../components/ui/toaster";
import SettingsLayout from "../../components/SettingsLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import type { Permission, Resource } from "../../server/api/rbac";
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

  const selectedPermissions = watch("permissions") || [];

  const onSubmit = handleSubmit(async (data) => {
    await createRole.mutateAsync({
      organizationId,
      name: data.name,
      description: data.description,
      permissions: data.permissions,
    });
    reset();
  });

  return (
    <VStack align="start" width="full" padding={8} gap={6}>
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

        <HStack width="full" gap={4} flexWrap="wrap">
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
        </HStack>
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

        <HStack width="full" gap={4} flexWrap="wrap">
          {roles.data?.map((role) => (
            <RoleCard
              key={role.id}
              name={role.name}
              description={role.description ?? ""}
              permissionCount={`${role.permissions.length} permissions`}
              onDelete={() => {
                if (
                  confirm(
                    `Are you sure you want to delete the role "${role.name}"?`
                  )
                ) {
                  deleteRole.mutate({ roleId: role.id });
                }
              }}
            />
          ))}
        </HStack>
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
    </VStack>
  );
}

function RoleCard({
  name,
  description,
  permissionCount,
  isDefault = false,
  onDelete,
}: {
  name: string;
  description: string;
  permissionCount: string;
  isDefault?: boolean;
  onDelete?: () => void;
}) {
  return (
    <Card.Root
      width="300px"
      borderWidth="1px"
      borderColor="gray.200"
      _hover={{ borderColor: "orange.400", shadow: "md" }}
      transition="all 0.2s"
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
          {!isDefault && onDelete && (
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
      </Card.Header>
      <Card.Body paddingTop={0}>
        <VStack align="start" gap={2}>
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

/**
 * IndeterminateCheckbox component
 *
 * Single Responsibility: Renders a checkbox that can be in an indeterminate state
 */
function IndeterminateCheckbox({
  checked,
  indeterminate,
  onChange,
  children,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  children?: React.ReactNode;
}) {
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <Checkbox ref={checkboxRef} checked={checked} onChange={onChange}>
      {children}
    </Checkbox>
  );
}

function PermissionSelector({
  selectedPermissions,
  onChange,
}: {
  selectedPermissions: Permission[];
  onChange: (permissions: Permission[]) => void;
}) {
  const groupedPermissions: Record<Resource, Permission[]> = {} as Record<
    Resource,
    Permission[]
  >;

  // Group permissions by resource
  Object.values(Resources).forEach((resource) => {
    groupedPermissions[resource] = Object.values(Actions).map(
      (action) => `${resource}:${action}` as Permission
    );
  });

  // Define which actions are valid for each resource
  const getValidActionsForResource = (resource: Resource): Action[] => {
    // Share is only available for messages
    if (resource === Resources.MESSAGES) {
      return [
        Actions.VIEW,
        Actions.CREATE,
        Actions.UPDATE,
        Actions.DELETE,
        Actions.MANAGE,
        Actions.SHARE,
      ];
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

  const togglePermission = (permission: Permission) => {
    if (selectedPermissions.includes(permission)) {
      onChange(selectedPermissions.filter((p) => p !== permission));
    } else {
      onChange([...selectedPermissions, permission]);
    }
  };

  const toggleAllForResource = (resource: Resource) => {
    const resourcePermissions = groupedPermissions[resource]!;
    const allSelected = resourcePermissions.every((p) =>
      selectedPermissions.includes(p)
    );

    if (allSelected) {
      onChange(
        selectedPermissions.filter((p) => !resourcePermissions.includes(p))
      );
    } else {
      const newPermissions = [
        ...selectedPermissions.filter((p) => !resourcePermissions.includes(p)),
        ...resourcePermissions,
      ];
      onChange(newPermissions);
    }
  };

  return (
    <VStack align="start" width="full" gap={4}>
      {(Object.keys(groupedPermissions) as Resource[]).map((resource) => {
        const permissions = groupedPermissions[resource]!;
        const allSelected = permissions.every((p) =>
          selectedPermissions.includes(p)
        );
        const someSelected =
          permissions.some((p) => selectedPermissions.includes(p)) &&
          !allSelected;

        const validActions = getValidActionsForResource(resource);

        return (
          <Box key={resource} width="full">
            <Fieldset.Root>
              <Fieldset.Legend
                fontSize="sm"
                fontWeight="semibold"
                textTransform="capitalize"
                marginBottom={2}
                cursor="pointer"
                onClick={() => toggleAllForResource(resource)}
                _hover={{ color: "orange.600" }}
              >
                <HStack>
                  <IndeterminateCheckbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={() => toggleAllForResource(resource)}
                  />
                  <Text>{resource}</Text>
                </HStack>
              </Fieldset.Legend>
              <Fieldset.Content>
                <HStack gap={4} flexWrap="wrap" paddingLeft={6}>
                  {validActions.map((action) => {
                    const permission: Permission = `${resource}:${action}`;
                    return (
                      <Checkbox
                        key={permission}
                        checked={selectedPermissions.includes(permission)}
                        onChange={() => togglePermission(permission)}
                      >
                        <Text fontSize="sm" textTransform="capitalize">
                          {action}
                        </Text>
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
