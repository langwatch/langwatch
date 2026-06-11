import {
  Box,
  Button,
  HStack,
  IconButton,
  Separator,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import type { LangyConversationSummary } from "./useLangyConversations";

export function RecentList({
  conversations,
  isLoading,
  hasError,
  onSelect,
  onDelete,
}: {
  conversations: LangyConversationSummary[];
  isLoading: boolean;
  hasError: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (hasError) return null;
  if (!isLoading && conversations.length === 0) return null;

  return (
    <>
      <VStack
        align="stretch"
        gap={1}
        paddingX={3}
        paddingY={2}
        background="bg.subtle"
        flexShrink={0}
        maxHeight="220px"
        overflowY="auto"
      >
        <Text
          textStyle="2xs"
          fontWeight="600"
          letterSpacing="0.08em"
          color="fg.subtle"
          textTransform="uppercase"
          paddingX={1}
          paddingBottom={1}
        >
          Recent chats
        </Text>
        {isLoading ? (
          <HStack
            gap={2}
            paddingX={1}
            paddingY={1.5}
            aria-label="Loading recent conversations"
          >
            <Spinner size="xs" />
            <Text textStyle="xs" color="fg.muted">
              Loading…
            </Text>
          </HStack>
        ) : (
          <Box
            as="ul"
            aria-label="Recent conversations"
            listStyleType="none"
            margin={0}
            padding={0}
          >
            {conversations.map((conv) => (
              <HStack key={conv.id} as="li" gap={1}>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => onSelect(conv.id)}
                  flex={1}
                  justifyContent="flex-start"
                  fontWeight="normal"
                  color="fg"
                  paddingX={2}
                  truncate
                >
                  {conv.title ?? "Untitled"}
                </Button>
                <IconButton
                  size="2xs"
                  variant="ghost"
                  color="fg.subtle"
                  aria-label="Delete conversation"
                  onClick={() => onDelete(conv.id)}
                >
                  <Trash2 size={12} />
                </IconButton>
              </HStack>
            ))}
          </Box>
        )}
      </VStack>
      <Separator />
    </>
  );
}
