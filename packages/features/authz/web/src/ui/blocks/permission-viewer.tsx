/**
 * A role's permissions, read-only, grouped by resource.
 *
 * Moved from `platform/app/src/components/settings/PermissionViewer.tsx`; the
 * catalogue it reads is this package's copy rather than
 * `~/utils/permissionsConfig`, which kept three server-side test consumers.
 *
 * TWO DISPLAY RULES TRAVEL WITH IT, and both are about not repeating yourself
 * at the reader. A resource with nothing granted renders no heading at all. And
 * a resource granted `manage` shows only `manage` (and `share`, which manage
 * does not imply), because listing view/create/update/delete underneath it says
 * the same thing four more times.
 *
 * Membership is read RAW here rather than through the hierarchy: what this
 * shows is the permission list as stored, which for a built-in role is the bag
 * the authorization contract publishes. `__tests__/builtin-roles.unit.test.ts`
 * pins that the bag and the engine's hierarchy-aware verdict agree over
 * everything the catalogue offers, so raw membership cannot under-report.
 */

import { Box, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { Check } from "react-feather";
import {
  actionOf,
  type AuthzAction,
  type AuthzResource,
  ORDERED_RESOURCES,
  permissionsByResource,
} from "../../model/permission-catalogue";

/** What one action is called in the list. */
function actionText(action: AuthzAction): string {
  if (action === "manage") return "Manage (Create, Update, Delete)";
  return action.charAt(0).toUpperCase() + action.slice(1);
}

export function PermissionViewer({ permissions }: { permissions: readonly AuthzPermission[] }) {
  const offered = permissionsByResource();

  return (
    <VStack align="start" width="full" gap={4}>
      {ORDERED_RESOURCES.map((resource: AuthzResource) => {
        // The grouped list is already narrowed to what the registry admits, so
        // the actions are read back off it rather than off the catalogue twice.
        const grantedActions = (offered[resource] ?? [])
          .filter((permission) => permissions.includes(permission))
          .map((permission) => actionOf(permission))
          .filter((action): action is AuthzAction => action !== void 0);

        if (grantedActions.length === 0) return null;

        const hasManage = grantedActions.includes("manage");
        const displayActions = hasManage
          ? grantedActions.filter((action) => action === "manage" || action === "share")
          : grantedActions;

        return (
          <Box key={resource} width="full">
            <VStack align="start" gap={2} width="full">
              <Text fontWeight="semibold" textTransform="capitalize" fontSize="md">
                {resource}
              </Text>
              <VStack align="start" gap={1.5} paddingLeft={4} width="full">
                {displayActions.map((action) => (
                  <HStack key={`${resource}:${action}`} gap={2} align="center">
                    <Check size={14} color="var(--chakra-colors-green-500)" />
                    <Text fontSize="sm" color="fg">
                      {actionText(action)}
                    </Text>
                  </HStack>
                ))}
              </VStack>
            </VStack>
            <Separator marginY={3} />
          </Box>
        );
      })}
    </VStack>
  );
}
