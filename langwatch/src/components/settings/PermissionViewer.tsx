import { Box, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import { Check } from "react-feather";
import type { Permission, Resource, Action } from "../../server/api/rbac";
import {
  orderedResources,
  getValidActionsForResource,
} from "../../utils/permissionsConfig";

/**
 * PermissionViewer component
 *
 * Single Responsibility: Displays permissions in a read-only, organized format
 */
export function PermissionViewer({
  permissions,
}: {
  permissions: Permission[];
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

  // Group permissions by resource using shared valid actions
  resourceOrder.forEach((resource) => {
    const validActions = getValidActionsForResource(resource);
    groupedPermissions[resource] = validActions.map((action) =>
      createPermission(resource, action),
    );
  });

  return (
    <VStack align="start" width="full" gap={4}>
      {(Object.keys(groupedPermissions) as Resource[]).map((resource) => {
        const validActions = getValidActionsForResource(resource);
        const hasAnyPermission = validActions.some((action) =>
          permissions.includes(`${resource}:${action}`),
        );

        if (!hasAnyPermission) return null;

        const grantedActions = validActions.filter((action) =>
          permissions.includes(`${resource}:${action}`),
        );

        // If manage is present, filter out view, create, update, delete since manage includes them
        const hasManage = grantedActions.includes("manage");
        const displayActions = hasManage
          ? grantedActions.filter((action) => action === "manage" || action === "share")
          : grantedActions;

        return (
          <Box key={resource} width="full">
            <VStack align="start" gap={2} width="full">
              <Text
                fontWeight="semibold"
                textTransform="capitalize"
                fontSize="md"
              >
                {resource}
              </Text>
              <VStack align="start" gap={1.5} paddingLeft={4} width="full">
                {displayActions.map((action) => {
                  const permission = createPermission(resource, action);
                  const actionText =
                    action === "manage"
                      ? "Manage (Create, Update, Delete)"
                      : action.charAt(0).toUpperCase() + action.slice(1);
                  return (
                    <HStack key={permission} gap={2} align="center">
                      <Check size={14} color="var(--chakra-colors-green-500)" />
                      <Text fontSize="sm" color="gray.700">
                        {actionText}
                      </Text>
                    </HStack>
                  );
                })}
              </VStack>
            </VStack>
            <Separator marginY={3} />
          </Box>
        );
      })}
    </VStack>
  );
}
