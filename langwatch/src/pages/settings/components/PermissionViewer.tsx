import { Box, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import type { Permission, Resource, Action } from "../../../server/api/rbac";
import {
  orderedResources,
  getValidActionsForResource,
} from "../../../utils/permissionsConfig";

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

  // Reuse shared getValidActionsForResource

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
