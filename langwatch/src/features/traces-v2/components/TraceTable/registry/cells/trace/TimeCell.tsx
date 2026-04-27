import { Box, HStack, Icon, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type React from "react";
import { Tooltip } from "~/components/ui/tooltip";
import type { TraceListItem } from "../../../../../types/trace";
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";

export const TimeCell: CellDef<TraceListItem> = {
  id: "time",
  label: "Time",
  render: ({ row, isExpanded, actions }) => (
    <HStack gap={1}>
      {actions.onTogglePeek && (
        <PeekButton isExpanded={isExpanded} onClick={actions.onTogglePeek} />
      )}
      <Tooltip content={formatAbsoluteTime(row.timestamp)}>
        <MonoCell color="fg.subtle">
          {formatRelativeTime(row.timestamp)}
        </MonoCell>
      </Tooltip>
    </HStack>
  ),
  renderComfortable: ({ row, isExpanded, actions }) => (
    <HStack gap={2}>
      {actions.onTogglePeek && (
        <PeekButton isExpanded={isExpanded} onClick={actions.onTogglePeek} />
      )}
      <Tooltip content={formatAbsoluteTime(row.timestamp)}>
        <Text textStyle="sm" color="fg.muted">
          {formatRelativeTime(row.timestamp)}
        </Text>
      </Tooltip>
    </HStack>
  ),
};

const PeekButton: React.FC<{
  isExpanded: boolean;
  onClick: () => void;
}> = ({ isExpanded, onClick }) => (
  <Box
    as="button"
    onClick={(e: React.MouseEvent) => {
      e.stopPropagation();
      onClick();
    }}
    display="flex"
    alignItems="center"
    justifyContent="center"
    flexShrink={0}
    width="16px"
    height="16px"
    borderRadius="sm"
    color={isExpanded ? "fg" : "fg.subtle/50"}
    _hover={{ color: "fg", bg: "fg.subtle/10" }}
    transition="color 0.1s"
  >
    <Icon boxSize="12px">
      {isExpanded ? <ChevronDown /> : <ChevronRight />}
    </Icon>
  </Box>
);
