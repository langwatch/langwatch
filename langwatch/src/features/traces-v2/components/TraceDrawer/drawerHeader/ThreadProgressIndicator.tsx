import {
  Box,
  Button,
  HStack,
  Icon,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useState } from "react";
import { LuCheck, LuCopy, LuFilter } from "react-icons/lu";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Popover } from "~/components/ui/popover";
import { Tooltip } from "~/components/ui/tooltip";

interface ThreadProgressIndicatorProps {
  position: number;
  total: number;
  /**
   * The conversation id this thread belongs to. When provided, clicking
   * the indicator opens a popover with copy + filter actions so the
   * conversation auto-pin can drop out of the strip without losing
   * affordances.
   */
  conversationId?: string | null;
  /** Click handler for the popover's "filter table by this conversation". */
  onFilterByConversation?: () => void;
  isLoading?: boolean;
}

/**
 * Visual position-in-conversation marker. When `conversationId` is set,
 * the indicator becomes a popover trigger that exposes copy + filter
 * actions for the conversation id, so the redundant Conversation
 * auto-pin can drop out of the context strip.
 */
export function ThreadProgressIndicator({
  position,
  total,
  conversationId,
  onFilterByConversation,
  isLoading = false,
}: ThreadProgressIndicatorProps) {
  const safePosition = Math.max(1, Math.min(position, total));
  const percent = total > 0 ? (safePosition / total) * 100 : 0;
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!conversationId) return;
    void navigator.clipboard.writeText(conversationId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [conversationId]);

  const body = (
    <HStack
      gap={1.5}
      flexShrink={0}
      cursor={conversationId ? "pointer" : "default"}
      paddingX={conversationId ? 1.5 : 0}
      paddingY={conversationId ? 0.5 : 0}
      borderRadius={conversationId ? "sm" : undefined}
      _hover={
        conversationId ? { bg: "bg.muted" } : undefined
      }
      transition="background 0.12s ease"
    >
      {isLoading ? (
        <Spinner size="xs" color="blue.solid" borderWidth="1.5px" />
      ) : null}
      <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
        {safePosition} / {total}
      </Text>
      <Box
        width="48px"
        height="2px"
        borderRadius="full"
        bg="border.muted"
        overflow="hidden"
        position="relative"
      >
        <Box
          width={`${percent}%`}
          height="full"
          bg="blue.solid"
          transition="width 0.18s ease"
          opacity={isLoading ? 0.5 : 1}
        />
        {isLoading ? (
          <Box
            position="absolute"
            inset={0}
            css={{
              background:
                "linear-gradient(90deg, transparent, var(--chakra-colors-blue-solid) 50%, transparent)",
              backgroundSize: "200% 100%",
              animation: "threadShimmer 1.1s ease-in-out infinite",
              "@keyframes threadShimmer": {
                "0%": { backgroundPosition: "200% 0" },
                "100%": { backgroundPosition: "-200% 0" },
              },
              opacity: 0.7,
            }}
          />
        ) : null}
      </Box>
    </HStack>
  );

  // Without a conversation id there's no popover content worth opening —
  // fall back to the bare hover tooltip describing arrow-key navigation.
  if (!conversationId) {
    return (
      <Tooltip
        content={
          <HStack gap={1}>
            <Text>{isLoading ? "Loading…" : "Navigate thread"}</Text>
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
          </HStack>
        }
        positioning={{ placement: "bottom" }}
      >
        {body}
      </Tooltip>
    );
  }

  return (
    <Popover.Root positioning={{ placement: "bottom-start" }} lazyMount>
      <Popover.Trigger asChild>
        <Box
          as="button"
          aria-label={`Conversation ${conversationId} — ${safePosition} of ${total}`}
        >
          {body}
        </Box>
      </Popover.Trigger>
      <Popover.Content width="320px">
        <Popover.Body padding={3}>
          <VStack align="stretch" gap={2.5}>
            <VStack align="start" gap={0.5}>
              <Text textStyle="2xs" color="fg.muted" textTransform="uppercase">
                Conversation
              </Text>
              <HStack gap={1.5} width="full">
                <Text
                  textStyle="xs"
                  fontFamily="mono"
                  truncate
                  flex={1}
                  minWidth={0}
                >
                  {conversationId}
                </Text>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={handleCopy}
                  aria-label="Copy conversation ID"
                  flexShrink={0}
                >
                  <Icon as={copied ? LuCheck : LuCopy} boxSize={3} />
                </Button>
              </HStack>
            </VStack>

            <Text textStyle="2xs" color="fg.subtle">
              Turn {safePosition} of {total}. Use{" "}
              <Kbd>←</Kbd>
              {" / "}
              <Kbd>→</Kbd>
              {" to navigate."}
            </Text>

            {onFilterByConversation && (
              <Button
                size="xs"
                variant="outline"
                onClick={onFilterByConversation}
                aria-label="Filter trace table by this conversation"
              >
                <Icon as={LuFilter} boxSize={3} />
                <Text>Filter table by this conversation</Text>
              </Button>
            )}
          </VStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
