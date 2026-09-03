import { Box, Circle, chakra, HStack, Icon, Text } from "@chakra-ui/react";
import { AlertTriangle, ChevronDown, ChevronRight, Zap } from "lucide-react";
import type React from "react";
import { truncateId, useFilterStore, useViewStore } from "../../../../../../../index";
import type { ConversationGroup } from "../../../conversation-groups";
import { IOPreview } from "../../../io-preview";
import type { CellDef, RowActions } from "../../types";

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

/**
 * Expands the conversation's turns inline. The rest of the row opens the
 * conversation's latest trace in the drawer, so the chevron is what expanding
 * goes through; its click stops propagating rather than doing both at once.
 */
const ExpandToggle: React.FC<{
  isExpanded: boolean;
  actions: RowActions;
  boxSize: string;
  marginTop: string;
}> = ({ isExpanded, actions, boxSize, marginTop }) => (
  <chakra.button
    type="button"
    aria-label={isExpanded ? "Collapse turns" : "Expand turns"}
    cursor="pointer"
    display="inline-flex"
    flexShrink={0}
    marginTop={marginTop}
    bg="transparent"
    border="none"
    p={0}
    color="fg.subtle"
    _hover={{ color: "fg" }}
    onClick={(e: React.MouseEvent) => {
      e.stopPropagation();
      actions.onToggleExpand?.();
    }}
  >
    <Icon boxSize={boxSize}>{isExpanded ? <ChevronDown /> : <ChevronRight />}</Icon>
  </chakra.button>
);

/**
 * What the row calls the conversation: the agent's own title when there is one
 * the viewer may read, otherwise the shortened conversation id.
 * `titleRedacted` is decided server-side and only read here.
 */
export function sessionLabelOf(group: ConversationGroup): string {
  if (group.title && !group.titleRedacted) return group.title;
  return truncateId(group.conversationId);
}

/**
 * The conversation's label, a button styled as a link that scopes the All lens
 * to just this conversation. It filters rather than navigates, so it is a
 * button and not an anchor. The label IS the filter affordance (the rest of
 * the row opens the drawer), so its click stops propagation; the blue colour
 * plus a hover underline and tooltip signal it acts differently from the row.
 */
const ConversationIdLabel: React.FC<{
  conversationId: string;
  label: string;
  comfortable?: boolean;
}> = ({ conversationId, label, comfortable = false }) => {
  const selectLens = useViewStore((s) => s.selectLens);
  const applyQueryText = useFilterStore((s) => s.applyQueryText);

  const filterToConversation = (e: React.MouseEvent) => {
    e.stopPropagation();
    // All lens, scoped to just this conversation. Escaping mirrors
    // useConversationTurns so ids with quotes/backslashes round-trip.
    selectLens("all-traces");
    const escaped = conversationId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    applyQueryText(`conversation:"${escaped}"`);
  };

  return (
    <chakra.button
      type="button"
      aria-label="Filter to this conversation"
      title="Show all traces in this conversation"
      onClick={filterToConversation}
      cursor="pointer"
      flexShrink={0}
      bg="transparent"
      border="none"
      p={0}
      textAlign="left"
      color="blue.fg"
      textStyle="xs"
      fontWeight={comfortable ? "500" : undefined}
      marginTop={comfortable ? "2px" : undefined}
      // A generated title can run long; the preview beside it keeps the rest
      // of the row, so the label truncates rather than pushing it out.
      maxWidth="320px"
      truncate
      _hover={{ textDecoration: "underline" }}
    >
      {label}
    </chakra.button>
  );
};

export const ConversationCell: CellDef<ConversationGroup> = {
  id: "conversation",
  label: "Conversation",
  render: ({ row, isExpanded, actions }) => {
    const io = conversationIO(row);
    return (
      <HStack gap={2} align="start" width="full" minWidth={0}>
        <ExpandToggle isExpanded={isExpanded} actions={actions} boxSize="14px" marginTop="2px" />
        <ConversationIdLabel conversationId={row.conversationId} label={sessionLabelOf(row)} />
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
  renderComfortable: ({ row, isExpanded, actions }) => {
    const io = conversationIO(row);
    return (
      <HStack gap={3} align="start" width="full" minWidth={0}>
        <ExpandToggle isExpanded={isExpanded} actions={actions} boxSize="16px" marginTop="3px" />
        <ConversationIdLabel
          conversationId={row.conversationId}
          label={sessionLabelOf(row)}
          comfortable
        />
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

const ConversationSummaryChips: React.FC<{ group: ConversationGroup }> = ({ group }) => (
  <HStack gap={2} flexShrink={0} textStyle="2xs" color="fg.subtle" marginTop="2px">
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
        <Circle size="6px" bg={group.evalsFailedCount > 0 ? "red.solid" : "green.solid"} />
        <Text>
          {group.evalsPassedCount}/{group.totalEvals}
        </Text>
      </HStack>
    )}
  </HStack>
);
