import { Box, HStack, Text } from "@chakra-ui/react";
import { Tooltip } from "../ui/tooltip";
import {
  permissionSentence,
  resourceCopy,
  splitPermission,
} from "./rolePermissions";

/**
 * A permission, in the form the reader will meet it again.
 *
 * `traces:view` is the vocabulary the engine grants from and the string the
 * audit log records, so the screen shows it rather than a translation that
 * would leave the reader unable to recognise either. It is set in the code
 * face and split at the colon — the thing in the foreground, the action after
 * it in a quieter one — so a column of thirty tokens can be scanned by
 * resource without reading a single one in full. The sentence lives on hover,
 * where it explains the token instead of replacing it.
 */
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

/**
 * A handful of tokens and an honest count of the rest.
 *
 * A card that lists every permission a role holds is a card nobody reads, and
 * one that lists a few without saying so is a card that lies. So: the few, and
 * then how many more there are.
 */
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
