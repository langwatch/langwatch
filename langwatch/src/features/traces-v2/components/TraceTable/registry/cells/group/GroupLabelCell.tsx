import { Box, HStack, Icon, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CellDef } from "../../types";
import { type TraceGroup, dotColorForIndex } from "./types";

export const GroupLabelCell: CellDef<TraceGroup> = {
  id: "group",
  label: "Group",
  render: ({ row, isExpanded }) => (
    <HStack gap={2}>
      <Icon boxSize="14px" color="fg.subtle" flexShrink={0}>
        {isExpanded ? <ChevronDown /> : <ChevronRight />}
      </Icon>
      <Box
        width="8px"
        height="8px"
        borderRadius="full"
        bg={dotColorForIndex(row.index)}
        flexShrink={0}
      />
      <Text textStyle="sm" fontWeight="600" color="fg" truncate minWidth={0}>
        {row.label}
      </Text>
    </HStack>
  ),
  renderComfortable: ({ row, isExpanded }) => (
    <HStack gap={3}>
      <Icon boxSize="16px" color="fg.subtle" flexShrink={0}>
        {isExpanded ? <ChevronDown /> : <ChevronRight />}
      </Icon>
      <Box
        width="10px"
        height="10px"
        borderRadius="full"
        bg={dotColorForIndex(row.index)}
        flexShrink={0}
      />
      <Text textStyle="md" fontWeight="500" color="fg" truncate minWidth={0}>
        {row.label}
      </Text>
    </HStack>
  ),
};
