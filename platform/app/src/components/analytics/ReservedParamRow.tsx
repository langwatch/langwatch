/**
 * One reserved (built-in) LWQL parameter, shown read-only above author rows.
 *
 * Shared by the dashboard widget query editor and the LWQL workbench's
 * parameters editor — both list the same `RESERVED_PARAMETERS` set the same
 * way, so the row markup lives once rather than being hand-duplicated.
 */

import { Badge, Box, HStack, Text } from "@chakra-ui/react";

import type { RESERVED_PARAMETERS } from "~/server/analytics/dashboardWidgetDefinition";

export function ReservedParamRow({
  reserved,
  value,
}: {
  reserved: (typeof RESERVED_PARAMETERS)[number];
  /** The parameter's current live value, shown when known. */
  value?: string;
}) {
  return (
    <HStack gap={2} title={reserved.description}>
      <Text
        fontSize="12px"
        fontFamily="mono"
        flex={1}
        minWidth={0}
        truncate
        color="fg.muted"
      >
        {reserved.name}
      </Text>
      <Text fontSize="12px" color="fg.muted" width="90px" flexShrink={0}>
        {reserved.type}
      </Text>
      {value !== undefined && (
        <Text
          fontSize="12px"
          fontFamily="mono"
          color="fg.muted"
          flexShrink={0}
          truncate
          maxWidth="180px"
        >
          {value}
        </Text>
      )}
      <Badge size="sm" colorPalette="gray" flexShrink={0}>
        built-in
      </Badge>
      {/* Spacer matching the remove IconButton's width so name/type columns
          still line up with the editable rows below. */}
      <Box width="26px" flexShrink={0} />
    </HStack>
  );
}
