// A permission as the engine spells it, split at the colon; the sentence lives on hover.

import { Box, HStack, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

import { permissionSentence, resourceCopy, splitPermission } from "../../model/role-permissions.ts";

export function PermissionToken({
  permission,
  muted = false,
}: {
  permission: string;
  /** For a permission that is listed but not in force where it is assigned. */
  muted?: boolean;
}) {
  const { resource, action } = splitPermission(permission);

  return (
    <Tooltip
      content={`${permissionSentence(permission)}. ${resourceCopy(resource).blurb}`}
      positioning={{ placement: "top" }}
      showArrow
    >
      <Box
        as="span"
        display="inline-flex"
        alignItems="baseline"
        gap={0}
        paddingX={1.5}
        paddingY={0.5}
        borderRadius="md"
        borderWidth="1px"
        borderColor="border.muted"
        background="bg.subtle"
        fontFamily="mono"
        fontSize="xs"
        lineHeight="1.4"
        whiteSpace="nowrap"
        opacity={muted ? 0.55 : 1}
        data-testid="permission-token"
      >
        <Text as="span" color="fg">
          {resource}
        </Text>
        <Text as="span" color="fg.subtle">
          :{action}
        </Text>
      </Box>
    </Tooltip>
  );
}

/** A few tokens and an honest count of the rest. */
export function PermissionTokenList({
  permissions,
  limit = 4,
  mutedPermissions,
}: {
  permissions: readonly string[];
  limit?: number;
  /** Permissions to dim, because they do nothing where this role is used. */
  mutedPermissions?: ReadonlySet<string>;
}) {
  const shown = permissions.slice(0, limit);
  const remaining = permissions.length - shown.length;

  if (permissions.length === 0) {
    return (
      <Text fontSize="xs" color="fg.subtle">
        No permissions yet
      </Text>
    );
  }

  return (
    <HStack gap={1.5} flexWrap="wrap">
      {shown.map((permission) => (
        <PermissionToken
          key={permission}
          permission={permission}
          muted={mutedPermissions?.has(permission)}
        />
      ))}
      {remaining > 0 && (
        <Text fontSize="xs" color="fg.muted">
          and {remaining} more
        </Text>
      )}
    </HStack>
  );
}
