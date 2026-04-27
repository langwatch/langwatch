import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { LuChevronLeft, LuChevronRight, LuUser, LuBot, LuWrench } from "react-icons/lu";
import type { Conversation, ConversationTurn } from "../../types/trace";

interface ContextPeekProps {
  conversation: Conversation;
  currentTurnNumber: number;
  onNavigateToTurn: (traceId: string) => void;
}

function TurnLine({ turn, isCurrent }: { turn: ConversationTurn; isCurrent: boolean }) {
  const { trace } = turn;
  const userMsg = trace.input;
  const assistantMsg = trace.output;

  const icon = userMsg ? LuUser : assistantMsg ? LuBot : LuWrench;
  const label = userMsg
    ? truncateMsg(userMsg, 60)
    : assistantMsg
      ? truncateMsg(assistantMsg, 60)
      : trace.name;

  return (
    <HStack
      gap={2}
      paddingX={2}
      paddingY={1}
      borderRadius="sm"
      bg={isCurrent ? "bg.emphasized" : undefined}
      opacity={isCurrent ? 1 : 0.6}
    >
      {isCurrent && <Text textStyle="xs" color="fg.muted">▸</Text>}
      <Icon as={icon} boxSize={3} color="fg.muted" flexShrink={0} />
      <Text textStyle="xs" color="fg" truncate>{label}</Text>
    </HStack>
  );
}

function truncateMsg(msg: string, max: number): string {
  if (msg.length <= max) return msg;
  return msg.slice(0, max) + "…";
}

export function ContextPeek({ conversation, currentTurnNumber, onNavigateToTurn }: ContextPeekProps) {
  const turns = conversation.turns;
  const currentIndex = currentTurnNumber - 1;

  const prevTurn = currentIndex > 0 ? turns[currentIndex - 1] : undefined;
  const currentTurn = turns[currentIndex];
  const nextTurn = currentIndex < turns.length - 1 ? turns[currentIndex + 1] : undefined;

  if (!currentTurn) return null;

  const prevTraceId = prevTurn?.trace.traceId;
  const nextTraceId = nextTurn?.trace.traceId;

  return (
    <VStack align="stretch" gap={0} paddingX={4} paddingY={2}>
      <HStack justify="space-between" marginBottom={1}>
        <Text textStyle="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase" letterSpacing="wide">
          Conversation Context
        </Text>
        <HStack gap={1}>
          <Button
            size="xs"
            variant="ghost"
            disabled={!prevTraceId}
            onClick={() => prevTraceId && onNavigateToTurn(prevTraceId)}
            aria-label="Previous turn"
            padding={0}
            minWidth="auto"
          >
            <Icon as={LuChevronLeft} boxSize={3.5} />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!nextTraceId}
            onClick={() => nextTraceId && onNavigateToTurn(nextTraceId)}
            aria-label="Next turn"
            padding={0}
            minWidth="auto"
          >
            <Icon as={LuChevronRight} boxSize={3.5} />
          </Button>
        </HStack>
      </HStack>
      <Box
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        overflow="hidden"
      >
        {prevTurn && <TurnLine turn={prevTurn} isCurrent={false} />}
        <TurnLine turn={currentTurn} isCurrent />
        {nextTurn && <TurnLine turn={nextTurn} isCurrent={false} />}
      </Box>
    </VStack>
  );
}
