import { HStack, Icon, Text } from "@chakra-ui/react";
import { AlertTriangle } from "lucide-react";
import type { TraceListItem } from "../../../../../types/trace";
import type { CellDef } from "../../types";

export const ErrorTextCell = {
  id: "error-text",
  label: "Error",
  render: ({ row }) => {
    if (!row.error) {
      return (
        <Text textStyle="sm" color="fg.subtle">
          —
        </Text>
      );
    }
    return (
      <HStack gap={1.5} align="start">
        <Icon boxSize="14px" color="red.solid" flexShrink={0} marginTop="2px">
          <AlertTriangle />
        </Icon>
        <Text textStyle="sm" color="red.fg" lineClamp={2} fontFamily="mono">
          {row.error}
        </Text>
      </HStack>
    );
  },
} as const satisfies CellDef<TraceListItem>;
