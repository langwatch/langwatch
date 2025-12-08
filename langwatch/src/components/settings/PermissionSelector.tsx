import {
  Box,
  Fieldset,
  HStack,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo } from "react";
import { Info } from "lucide-react";
import { Checkbox } from "../ui/checkbox";
import { Tooltip } from "../ui/tooltip";
import type { Permission, Resource, Action } from "../../server/api/rbac";
import {
  orderedResources,
  getValidActionsForResource,
} from "../../utils/permissionsConfig";

/**
 * PermissionSelector component
 *
 * Single Responsibility: Provides an interactive interface for selecting and managing permissions
 */
export function PermissionSelector({
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

  // Group permissions by resource using the correct valid actions
  const groupedPermissions = useMemo(() => {
    const grouped: Record<Resource, Permission[]> = {} as Record<
      Resource,
      Permission[]
    >;
    // Use orderedResources from shared config (PLAYGROUND hidden, ORG/TEAM omitted)
    orderedResources.forEach((resource) => {
      const validActions = getValidActionsForResource(resource);
      grouped[resource] = validActions.map((action) =>
        createPermission(resource, action),
      );
    });
    return grouped;
  }, []);

  /**
   * Get permissions that should be removed when removing a given permission
   *
   * Permission hierarchy rules:
   * - Removing "manage" removes all permissions for that resource
   * - Removing "view" removes create/update/delete (they require view)
   * - Removing other permissions only removes that specific permission
   */
  const getPermissionsToRemove = (
    permission: Permission,
    resource: Resource,
  ): Permission[] => {
    if (permission.endsWith(":manage")) {
      // Removing manage removes all permissions for this resource
      return groupedPermissions[resource] || [];
    }

    const [_, action] = permission.split(":") as [Resource, Action];
    if (action === "view") {
      // Removing view also removes create/update/delete (they require view)
      const resourcePermissions = groupedPermissions[resource] || [];
      const dependentActions = ["create", "update", "delete"];
      const dependentPermissions = resourcePermissions.filter((p) =>
        dependentActions.some((a) => p.endsWith(`:${a}`)),
      );
      return [permission, ...dependentPermissions];
    }

    // Removing other permissions only removes that specific permission
    return [permission];
  };

  /**
   * Get permissions that should be added when adding a given permission
   *
   * Permission hierarchy rules:
   * - Adding "manage" adds all permissions for that resource
   * - Adding create/update/delete automatically adds view (they require it)
   * - Adding other permissions only adds that specific permission
   */
  const getPermissionsToAdd = (
    permission: Permission,
    resource: Resource,
  ): Permission[] => {
    if (permission.endsWith(":manage")) {
      // Adding manage adds all permissions for this resource
      return groupedPermissions[resource] || [];
    }

    const [_, action] = permission.split(":") as [Resource, Action];
    if (action === "create" || action === "update" || action === "delete") {
      // Adding create/update/delete automatically adds view
      const viewPermission = createPermission(resource, "view");
      return [permission, viewPermission];
    }

    // Adding other permissions only adds that specific permission
    return [permission];
  };

  /**
   * Remove a permission and all its dependent permissions
   */
  const removePermission = (permission: Permission): void => {
    const [resource] = permission.split(":") as [Resource, Action];
    const permissionsToRemove = getPermissionsToRemove(permission, resource);
    const newPermissions = selectedPermissions.filter(
      (p) => !permissionsToRemove.includes(p),
    );
    onChange(newPermissions);
  };

  /**
   * Add a permission and all its required dependencies
   */
  const addPermission = (permission: Permission): void => {
    const [resource] = permission.split(":") as [Resource, Action];
    const permissionsToAdd = getPermissionsToAdd(permission, resource);
    const newPermissions = [
      ...selectedPermissions,
      ...permissionsToAdd.filter((p) => !selectedPermissions.includes(p)),
    ];
    onChange(newPermissions);
  };

  /**
   * Toggle a permission on or off, handling permission hierarchy rules
   *
   * Single Responsibility: Toggle a permission while maintaining proper
   * permission dependencies (manage includes all, view required for CRUD)
   */
  const togglePermission = (permission: Permission): void => {
    const [resource, action] = permission.split(":") as [Resource, Action];
    const managePermission = createPermission(resource, "manage");
    const hasManage = selectedPermissions.includes(managePermission);

    // If manage is selected, the permission is implicitly included
    // So we need to check if it's explicitly selected OR implicitly via manage
    const isExplicitlySelected = selectedPermissions.includes(permission);
    const isImplicitlySelected = hasManage && action !== "manage";

    if (isExplicitlySelected || isImplicitlySelected) {
      removePermission(permission);
    } else {
      addPermission(permission);
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
                    const hasManage =
                      selectedPermissions.includes(managePermission);
                    const isImplicitlyChecked =
                      action !== "manage" && hasManage;

                    const handleToggle = () => {
                      // If clicking on an implicitly checked permission, toggle manage instead
                      if (isImplicitlyChecked) {
                        togglePermission(managePermission);
                      } else {
                        togglePermission(permission);
                      }
                    };

                    return (
                      <Checkbox
                        key={permission}
                        checked={isChecked || isImplicitlyChecked}
                        onChange={handleToggle}
                        opacity={isImplicitlyChecked ? 0.6 : 1}
                        cursor={isImplicitlyChecked ? "not-allowed" : "pointer"}
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
