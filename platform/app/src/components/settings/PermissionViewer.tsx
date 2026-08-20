import { Box, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import { Check } from "react-feather";
import {
  type AuthzPermission,
  isRegistryPermission,
} from "@langwatch/authz";
import type { Action, Resource } from "../../server/api/rbac";
import {
  getValidActionsForResource,
  orderedResources,
} from "../../utils/permissionsConfig";

/**
 * PermissionViewer component
 *
 * Single Responsibility: Displays permissions in a read-only, organized format
 */
export function PermissionViewer({
  permissions,
}: {
  permissions: AuthzPermission[];
}) {
  // The registry is the vocabulary the engine grants from, so it is the
  // vocabulary the settings UI offers: the legacy per-resource action table
  // produces the full Resource x Action cross product, most of which no
  // grant can ever carry.
  const permissionsFor = (resource: Resource): AuthzPermission[] =>
    getValidActionsForResource(resource)
      .map((action) => `${resource}:${action}`)
      .filter(isRegistryPermission);

  const groupedPermissions: Record<Resource, AuthzPermission[]> = {} as Record<
    Resource,
    AuthzPermission[]
  >;

  // Use orderedResources from shared config (PLAYGROUND hidden, ORG/TEAM omitted)
  const resourceOrder: Resource[] = orderedResources;

  // Group permissions by resource using shared valid actions
  resourceOrder.forEach((resource) => {
    groupedPermissions[resource] = permissionsFor(resource);
  });

  return (
    <VStack align="start" width="full" gap={4}>
      {(Object.keys(groupedPermissions) as Resource[]).map((resource) => {
        // The grouped list is already narrowed to what the registry
        // admits, so the actions are read back off it rather than off the
        // legacy table a second time.
        const grantedActions = (groupedPermissions[resource] ?? [])
          .filter((permission) => permissions.includes(permission))
          .map((permission) => permission.split(":")[1] as Action);

        if (grantedActions.length === 0) return null;

        // If manage is present, filter out view, create, update, delete since manage includes them
        const hasManage = grantedActions.includes("manage");
        const displayActions = hasManage
          ? grantedActions.filter(
              (action) => action === "manage" || action === "share",
            )
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
                  const permission = `${resource}:${action}`;
                  const actionText =
                    action === "manage"
                      ? "Manage (Create, Update, Delete)"
                      : action.charAt(0).toUpperCase() + action.slice(1);
                  return (
                    <HStack key={permission} gap={2} align="center">
                      <Check size={14} color="var(--chakra-colors-green-500)" />
                      <Text fontSize="sm" color="fg">
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
