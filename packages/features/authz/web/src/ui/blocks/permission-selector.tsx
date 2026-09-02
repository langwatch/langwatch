/**
 * The permission matrix a custom role is written in.
 *
 * Moved from `platform/app/src/components/settings/PermissionSelector.tsx` with
 * one change of shape and none of behaviour: the five rules that decide what a
 * click does are now {@link togglePermission} in `model/permission-matrix.ts`,
 * so they are a table a test can drive rather than closures over a `useMemo`.
 * This component renders the grid and reports the next list.
 *
 * The `manage` tooltip is what tells a reader why four boxes tick themselves
 * when they tick one, so it travels verbatim.
 */

import { Box, Fieldset, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Info } from "react-feather";
import {
  actionOf,
  type AuthzResource,
  ORDERED_RESOURCES,
  permissionsByResource,
} from "../../model/permission-catalogue";
import {
  isPermissionImplied,
  isPermissionSelected,
  togglePermission,
} from "../../model/permission-matrix";

export function PermissionSelector({
  selectedPermissions,
  onChange,
}: {
  selectedPermissions: readonly AuthzPermission[];
  onChange: (permissions: AuthzPermission[]) => void;
}) {
  const offered = permissionsByResource();

  return (
    <VStack align="start" width="full" gap={4}>
      {ORDERED_RESOURCES.map((resource: AuthzResource) => (
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
                {(offered[resource] ?? []).map((permission) => {
                  const action = actionOf(permission);
                  const chosen = isPermissionSelected({
                    selected: selectedPermissions,
                    permission,
                  });
                  const implied = isPermissionImplied({
                    selected: selectedPermissions,
                    permission,
                  });

                  return (
                    <Checkbox
                      key={permission}
                      value={permission}
                      checked={chosen || implied}
                      onChange={() =>
                        onChange(togglePermission({ selected: selectedPermissions, permission }))
                      }
                      opacity={implied ? 0.6 : 1}
                      cursor={implied ? "not-allowed" : "pointer"}
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
      ))}
    </VStack>
  );
}
