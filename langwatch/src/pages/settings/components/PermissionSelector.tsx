import {
  Box,
  Fieldset,
  HStack,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Info } from "react-feather";
import { Checkbox } from "../../../components/ui/checkbox";
import { Tooltip } from "../../../components/ui/tooltip";
import type { Permission, Resource, Action } from "../../../server/api/rbac";
import {
  orderedResources,
  getValidActionsForResource,
} from "../../../utils/permissionsConfig";

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
  const groupedPermissions: Record<Resource, Permission[]> = {} as Record<
    Resource,
    Permission[]
  >;

  // Use orderedResources from shared config (PLAYGROUND hidden, ORG/TEAM omitted)
  const resourceOrder: Resource[] = orderedResources;

  // Group permissions by resource using the correct valid actions
  resourceOrder.forEach((resource) => {
    const validActions = getValidActionsForResource(resource);
    groupedPermissions[resource] = validActions.map((action) =>
      createPermission(resource, action),
    );
  });

  const togglePermission = (permission: Permission) => {
    const [resource, action] = permission.split(":") as [Resource, Action];
    const viewPermission = createPermission(resource, "view");

    if (selectedPermissions.includes(permission)) {
      // If removing a permission, remove it and any dependent permissions
      let permissionsToRemove = [permission];

      // If removing manage, also remove all other permissions for this resource
      if (permission.endsWith(":manage")) {
        const resourcePermissions = groupedPermissions[resource] || [];
        permissionsToRemove = resourcePermissions;
      }
      // If removing view, also remove create/update/delete (can't use them without view)
      else if (action === "view") {
        const resourcePermissions = groupedPermissions[resource] || [];
        const dependentActions = ["create", "update", "delete"];
        const dependentPermissions = resourcePermissions.filter((p) =>
          dependentActions.some((a) => p.endsWith(`:${a}`)),
        );
        permissionsToRemove = [...permissionsToRemove, ...dependentPermissions];
      }

      onChange(
        selectedPermissions.filter((p) => !permissionsToRemove.includes(p)),
      );
    } else {
      // If adding a permission, add it and handle hierarchy
      let permissionsToAdd = [permission];

      // If adding manage, add all permissions for this resource
      if (permission.endsWith(":manage")) {
        const resourcePermissions = groupedPermissions[resource] || [];
        permissionsToAdd = resourcePermissions;
      }
      // If adding create/update/delete, also automatically add view
      else if (
        action === "create" ||
        action === "update" ||
        action === "delete"
      ) {
        permissionsToAdd.push(viewPermission);
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
