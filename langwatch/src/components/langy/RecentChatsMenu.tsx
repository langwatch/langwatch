/**
 * Header dropdown for Langy's conversation history.
 *
 * Replaces the always-visible "Recent chats" block that used to sit between
 * the panel header and the conversation — it permanently ate up to 220px of
 * the panel and crowded the active chat. History is reference material, not
 * something to stare at mid-conversation, so it lives behind a History
 * icon-button in the header (same pattern as every mainstream chat product).
 *
 * The trigger renders only when there's something to show (loading or ≥1
 * conversation) — mirroring the old block's render-nothing-when-empty rule.
 */
import {
  Box,
  Button,
  HStack,
  IconButton,
  Spinner,
  Text,
} from "@chakra-ui/react";
import { History, Trash2 } from "lucide-react";
import { useState } from "react";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import type { LangyConversationSummary } from "./useLangyConversations";

export function RecentChatsMenu({
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
  // Controlled open state: the rows are plain buttons (not Menu.Items, so a
  // nested delete button can live inside them), which means Chakra won't
  // auto-close on selection. Close explicitly when a chat is picked; keep
  // the menu open across deletes so cleaning up several chats is one visit.
  const [open, setOpen] = useState(false);

  if (hasError) return null;
  if (!isLoading && conversations.length === 0) return null;

  return (
    <Menu.Root
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
      positioning={{ placement: "bottom-end" }}
    >
      <Tooltip content="Recent chats" showArrow>
        <Menu.Trigger asChild>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label="Recent chats"
            color="fg.muted"
          >
            <History size={15} />
          </IconButton>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content
        minWidth="280px"
        maxHeight="320px"
        overflowY="auto"
        // Liquid-glass: translucent panel + backdrop blur, with saturate<1
        // draining the color out of whatever scrolls behind it so the list
        // reads as a frosted layer floating over the conversation.
        background="bg.panel/70"
        borderWidth="1px"
        borderColor="border.muted"
        boxShadow="lg"
        css={{
          backdropFilter: "blur(18px) saturate(0.5)",
          WebkitBackdropFilter: "blur(18px) saturate(0.5)",
        }}
      >
        {isLoading ? (
          <HStack
            gap={2}
            paddingX={2}
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
              <HStack
                key={conv.id}
                as="li"
                gap={1}
                borderRadius="sm"
                _hover={{ background: "bg.subtle", "& .row-delete": { opacity: 1 } }}
              >
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    onSelect(conv.id);
                    setOpen(false);
                  }}
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
                  className="row-delete"
                  size="2xs"
                  variant="ghost"
                  color="fg.subtle"
                  aria-label="Delete conversation"
                  // Hidden until the row is hovered — a column of trash icons
                  // reads as noise. Keyboard users still reach it: focus
                  // restores full opacity.
                  opacity={0}
                  _focusVisible={{ opacity: 1 }}
                  transition="opacity 120ms"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(conv.id);
                  }}
                >
                  <Trash2 size={12} />
                </IconButton>
              </HStack>
            ))}
          </Box>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}
