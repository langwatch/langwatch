import { Box, Circle, HStack, Icon, Text } from "@chakra-ui/react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Zap,
} from "lucide-react";
import type React from "react";
import { truncateId } from "../../../../../utils/formatters";
import { IOPreview } from "../../../IOPreview";
import { MonoCell } from "../../../MonoCell";
import type { ConversationGroup } from "../../../conversationGroups";
import type { CellDef } from "../../types";

interface ConversationIO {
  input: string | null;
  output: string | null;
  hasContent: boolean;
}

function conversationIO(group: ConversationGroup): ConversationIO {
  const input = group.traces[0]?.input ?? group.lastMessage ?? null;
  const output = group.lastOutput || null;
  return { input, output, hasContent: input !== null || output !== null };
}

export const ConversationCell: CellDef<ConversationGroup> = {
  id: "conversation",
  label: "Conversation",
  render: ({ row, isExpanded }) => {
    const io = conversationIO(row);
    return (
      <HStack gap={2} align="start" width="full" minWidth={0}>
        <Icon boxSize="14px" color="fg.subtle" flexShrink={0} marginTop="2px">
          {isExpanded ? <ChevronDown /> : <ChevronRight />}
        </Icon>
        <MonoCell color="blue.fg" flexShrink={0}>
          {truncateId(row.conversationId)}
        </MonoCell>
        <Box flex={1} minWidth={0}>
          {io.hasContent ? (
            <IOPreview input={io.input} output={io.output} />
          ) : (
            <Text textStyle="xs" color="fg.subtle">
              —
            </Text>
          )}
        </Box>
        {!isExpanded && <ConversationSummaryChips group={row} />}
      </HStack>
    );
  },
  renderComfortable: ({ row, isExpanded }) => {
    const io = conversationIO(row);
    return (
      <HStack gap={3} align="start" width="full" minWidth={0}>
        <Icon boxSize="16px" color="fg.subtle" flexShrink={0} marginTop="3px">
          {isExpanded ? <ChevronDown /> : <ChevronRight />}
        </Icon>
        <Text
          textStyle="xs"
          fontWeight="500"
          color="blue.fg"
          fontFamily="mono"
          flexShrink={0}
          marginTop="2px"
        >
          {truncateId(row.conversationId)}
        </Text>
        <Box flex={1} minWidth={0}>
          {io.hasContent ? (
            <IOPreview input={io.input} output={io.output} />
          ) : (
            <Text textStyle="xs" color="fg.subtle">
              —
            </Text>
          )}
        </Box>
        {!isExpanded && <ConversationSummaryChips group={row} />}
      </HStack>
    );
  },
};

const ConversationSummaryChips: React.FC<{ group: ConversationGroup }> = ({
  group,
}) => (
  <HStack
    gap={2}
    flexShrink={0}
    textStyle="2xs"
    color="fg.subtle"
    fontFamily="mono"
    marginTop="2px"
  >
    {group.errorCount > 0 && (
      <HStack gap={0.5}>
        <Icon boxSize="10px" color="red.fg">
          <AlertTriangle />
        </Icon>
        <Text color="red.fg">{group.errorCount}</Text>
      </HStack>
    )}
    {group.totalEvents > 0 && (
      <HStack gap={0.5}>
        <Icon boxSize="10px" color="orange.fg">
          <Zap />
        </Icon>
        <Text>{group.totalEvents}</Text>
      </HStack>
    )}
    {group.totalEvals > 0 && (
      <HStack gap={0.5}>
        <Circle
          size="6px"
          bg={group.evalsFailedCount > 0 ? "red.solid" : "green.solid"}
        />
        <Text>
          {group.evalsPassedCount}/{group.totalEvals}
        </Text>
      </HStack>
    )}
    {group.totalSpans > 0 && (
      <HStack gap={0.5}>
        <Icon boxSize="10px">
          <GitBranch />
        </Icon>
        <Text>{group.totalSpans}</Text>
      </HStack>
    )}
  </HStack>
);
