// Who holds a custom role: people by name, a group grant named as the group it came through.

import { Badge, Box, HStack, Text } from "@langwatch/design-system/primitives";

import type { Holder } from "../../model/role-holders.ts";
import { PrincipalAvatar } from "../elements/principal-avatar.tsx";

export function RoleHolderStrip({
  holders,
  people,
}: {
  holders: readonly Holder[];
  people: number | null;
}) {
  if (people === null) {
    return (
      <Text textStyle="bodySm" color="fg.subtle">
        Who holds this could not be read.
      </Text>
    );
  }
  if (holders.length === 0) {
    return (
      <Text textStyle="bodySm" color="fg.muted">
        Nobody yet.
      </Text>
    );
  }

  const shown = holders.slice(0, 5);
  const remaining = holders.length - shown.length;

  return (
    <HStack gap={2} flexWrap="wrap">
      {shown.map((holder) => (
        <HStack
          key={holder.key}
          gap={1.5}
          borderWidth="1px"
          borderColor="border"
          borderRadius="full"
          paddingLeft={1}
          paddingRight={2.5}
          paddingY={0.5}
        >
          <PrincipalAvatar
            id={holder.userId ?? holder.key}
            size="2xs"
            name={holder.name}
            image={holder.image}
          />
          <Text textStyle="caption">
            {holder.kind === "group" ? `via ${holder.name}` : holder.name}
          </Text>
          {holder.kind === "group" && holder.directory ? (
            <Badge
              size="xs"
              variant="outline"
              title={`This group is managed by ${holder.directory}.`}
            >
              Directory
            </Badge>
          ) : null}
        </HStack>
      ))}
      {remaining > 0 && (
        <Box textStyle="caption" color="fg.muted">
          and {remaining} more
        </Box>
      )}
    </HStack>
  );
}
