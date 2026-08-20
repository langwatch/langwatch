import {
  Box,
  Fieldset,
  HStack,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo } from "react";
import { Info } from "react-feather";
import {
  type AuthzPermission,
  isRegistryPermission,
} from "@langwatch/authz";
import type { Action, Resource } from "../../server/api/rbac";
import {
  getValidActionsForResource,
  orderedResources,
} from "../../utils/permissionsConfig";
import { Checkbox } from "../ui/checkbox";
import { Tooltip } from "../ui/tooltip";

/**
 * PermissionSelector component
 *
 * Single Responsibility: Provides an interactive interface for selecting and managing permissions
 */
export function PermissionSelector({
  selectedPermissions,
  onChange,
}: {
  selectedPermissions: AuthzPermission[];
  onChange: (permissions: AuthzPermission[]) => void;
}) {
  // The registry is the vocabulary the engine grants from, so it is the
  // vocabulary the settings UI offers: the legacy per-resource action table
  // produces the full Resource x Action cross product, most of which no
  // grant can ever carry.
  const permissionsFor = (resource: Resource): AuthzPermission[] =>
    getValidActionsForResource(resource)
      .map((action) => `${resource}:${action}`)
      .filter(isRegistryPermission);

  // Group permissions by resource using the correct valid actions
  const groupedPermissions = useMemo(() => {
    const grouped: Record<Resource, AuthzPermission[]> = {} as Record<
      Resource,
      AuthzPermission[]
    >;
    // Use orderedResources from shared config (PLAYGROUND hidden, ORG/TEAM omitted)
    orderedResources.forEach((resource) => {
      grouped[resource] = permissionsFor(resource);
    });
    return grouped;
  }, []);

  /** One resource's permission for an action, or null when the registry
   *  does not admit that pair. Read off the grouped list so the UI can only
   *  ever name a permission it is already showing. */
  const permissionIn = (
    resource: Resource,
    action: Action,
  ): AuthzPermission | null =>
    (groupedPermissions[resource] ?? []).find(
      (permission) => permission === `${resource}:${action}`,
    ) ?? null;

  /**
   * Get permissions that should be removed when removing a given permission
   *
   * AuthzPermission hierarchy rules:
   * - Removing "manage" removes all permissions for that resource
   * - Removing "view" removes create/update/delete (they require view)
   * - Removing other permissions only removes that specific permission
   */
  const getPermissionsToRemove = (
    permission: AuthzPermission,
    resource: Resource,
  ): AuthzPermission[] => {
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
   * AuthzPermission hierarchy rules:
   * - Adding "manage" adds all permissions for that resource
   * - Adding create/update/delete automatically adds view (they require it)
   * - Adding other permissions only adds that specific permission
   */
  const getPermissionsToAdd = (
    permission: AuthzPermission,
    resource: Resource,
  ): AuthzPermission[] => {
    if (permission.endsWith(":manage")) {
      // Adding manage adds all permissions for this resource
      return groupedPermissions[resource] || [];
    }

    const [_, action] = permission.split(":") as [Resource, Action];
    if (action === "create" || action === "update" || action === "delete") {
      // Adding create/update/delete automatically adds view
      const viewPermission = permissionIn(resource, "view");
      return viewPermission ? [permission, viewPermission] : [permission];
    }

    // Adding other permissions only adds that specific permission
    return [permission];
  };

  /**
   * Remove a permission and all its dependent permissions
   */
  const removePermission = (permission: AuthzPermission): void => {
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
  const addPermission = (permission: AuthzPermission): void => {
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
  const togglePermission = (permission: AuthzPermission): void => {
    const [resource, action] = permission.split(":") as [Resource, Action];
    const managePermission = permissionIn(resource, "manage");
    const hasManage =
      managePermission !== null &&
      selectedPermissions.includes(managePermission);

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
                  {(groupedPermissions[resource] ?? []).map((permission) => {
                    const action = permission.split(":")[1] as Action;
                    const isChecked = selectedPermissions.includes(permission);

                    // Implicitly checked when manage is selected: manage
                    // includes every other action on its resource.
                    const managePermission = permissionIn(resource, "manage");
                    const isImplicitlyChecked =
                      action !== "manage" &&
                      managePermission !== null &&
                      selectedPermissions.includes(managePermission);

                    const handleToggle = () => {
                      // Clicking an implicitly checked permission toggles the
                      // manage that implies it, not the permission itself.
                      if (isImplicitlyChecked && managePermission) {
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
                              <Box color="fg.muted">
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
