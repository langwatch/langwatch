// A permission as the engine spells it, split at the colon; the sentence lives on hover.

import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Box, HStack, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

import { permissionSentence, resourceCopy, splitPermission } from "../../model/role-permissions.ts";

export function PermissionToken({
  permission,
  muted = false,
  readable = false,
}: {
  permission: string;
  /** Show the sentence a person reads; the engine's key moves to the hover. */
  readable?: boolean;
  /** For a permission that is listed but not in force where it is assigned. */
  muted?: boolean;
}) {
  const { resource, action } = splitPermission(permission);

  return (
    <Tooltip
      content={
        readable
          ? `${permission}. ${resourceCopy(resource).blurb}`
          : `${permissionSentence(permission)}. ${resourceCopy(resource).blurb}`
      }
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
        textStyle={readable ? "caption" : "monoSm"}
        whiteSpace="nowrap"
        opacity={muted ? 0.55 : 1}
        data-testid="permission-token"
      >
        {readable ? (
          <Text as="span" color="fg">
            {permissionSentence(permission)}
          </Text>
        ) : (
          <>
            <Text as="span" color="fg">
              {resource}
            </Text>
            <Text as="span" color="fg.subtle">
              :{action}
            </Text>
          </>
        )}
      </Box>
    </Tooltip>
  );
}

/** A few tokens and an honest count of the rest. */
export function PermissionTokenList({
  permissions,
  limit = 4,
  mutedPermissions,
  readable = false,
}: {
  readable?: boolean;
  permissions: readonly string[];
  limit?: number;
  /** Permissions to dim, because they do nothing where this role is used. */
  mutedPermissions?: ReadonlySet<string>;
}) {
  const shown = permissions.slice(0, limit);
  const remaining = permissions.length - shown.length;

  if (permissions.length === 0) {
    return (
      <NoDataInfoBlock
        size="line"
        title="No permissions yet. Edit the role to choose what it grants."
      />
    );
  }

  return (
    <HStack gap={1.5} flexWrap="wrap">
      {shown.map((permission) => (
        <PermissionToken
          key={permission}
          permission={permission}
          muted={mutedPermissions?.has(permission)}
          readable={readable}
        />
      ))}
      {remaining > 0 && (
        <Text textStyle="caption" color="fg.muted">
          and {remaining} more
        </Text>
      )}
    </HStack>
  );
}
