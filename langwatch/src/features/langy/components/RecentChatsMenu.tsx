/**
 * Langy's conversation history, as a searchable listbox.
 *
 * History is reference material, not something to stare at mid-conversation, so
 * it lives behind a trigger in the header rather than in an always-visible block
 * (which used to permanently eat up to 220px of the panel). The Langy panel
 * passes its own trigger — the conversation TITLE — so clicking the title opens
 * the recents list, the pattern every mainstream chat app uses.
 *
 * WHY Combobox AND NOT Menu: this needs a search field, and a search field
 * inside a `Menu` means hand-rolling the listbox — an `<input>` plus a pile of
 * divs, with no roving focus, no `aria-activedescendant`, and arrow keys that do
 * nothing. Ark's `Combobox` IS a listbox: focus lands in the field on open,
 * typing filters, ↑/↓ move the highlight, Enter selects, Escape closes, and the
 * aria wiring comes with it. Same primitive, same reasons, as LangyModelPill.
 *
 * `Combobox.Control` is LOAD-BEARING: Ark positions the listbox against it. Omit
 * it — or hand it a rect from a ref via `getAnchorRect`, which is null on the
 * first open — and the popover collapses to the viewport's top-left corner.
 *
 * ── PAGINATION: NOT IMPLEMENTED, DELIBERATELY ──────────────────────────────
 * `langy.list` takes `{ projectId, limit }`. `limit` is capped at 100 and there
 * is NO cursor, no offset, and no server-side search. A client therefore cannot
 * ever see conversation #101, and "paginating" a fully-fetched array would be a
 * slice with extra steps: it would page prettily through 100 rows while quietly
 * pretending the 400 behind them do not exist.
 *
 * So the query now asks for the server's true maximum, and this list says out
 * loud how much it can see. Real paging needs a server change:
 *   1. `langy.list` gains `cursor` (updatedAt + id) and `query` inputs and
 *      returns `nextCursor`;
 *   2. `langy.conversations.getAll` and its repository take the same, with the
 *      title search pushed down into SQL;
 *   3. this component swaps the array for `useInfiniteQuery` and fetches the
 *      next page as the listbox nears its end.
 * Until then, search here is complete over everything a client is allowed to
 * have — which is the honest promise to make.
 */
import {
  Box,
  Combobox,
  createListCollection,
  HStack,
  IconButton,
  Portal,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { History, Trash2 } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import type { LangyConversationListItemDto } from "../data/langy.dtos";
import { LANGY_LIST_MAX } from "../data/useLangyConversationListQuery";
import { AnimatedConversationTitle } from "./AnimatedConversationTitle";

/** A conversation whose title reactor hasn't landed yet still needs a name. */
const UNTITLED = "Untitled chat";

/** Below this, a search field is more chrome than help. */
const SEARCH_FROM = 7;

interface ChatItem {
  value: string;
  title: string;
  /** True when the title is a stand-in, so the row can say so quietly. */
  untitled: boolean;
  searchText: string;
}

export function RecentChatsMenu({
  conversations,
  isLoading,
  hasError,
  onSelect,
  onDelete,
  trigger,
  placement = "bottom-end",
}: {
  conversations: LangyConversationListItemDto[];
  isLoading: boolean;
  hasError: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  /**
   * Host the listbox on a caller-supplied trigger instead of the default History
   * icon-button. When one is given and there is nothing to list, it renders BARE
   * — a caller that hands over its title must always get its title back.
   */
  trigger?: React.ReactNode;
  placement?: "bottom-end" | "bottom-start";
}) {
  const [query, setQuery] = useState("");

  const allItems = useMemo<ChatItem[]>(
    () =>
      conversations.map((conversation) => {
        const raw = conversation.title?.trim() ?? "";
        const untitled = raw.length === 0;
        const title = untitled ? UNTITLED : raw;
        return {
          value: conversation.id,
          title,
          untitled,
          searchText: title.toLowerCase(),
        };
      }),
    [conversations],
  );

  // Rebuilt per keystroke from the CURRENT items — the list arrives async, so a
  // one-shot snapshot would freeze it empty.
  const collection = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = q
      ? allItems.filter((item) => item.searchText.includes(q))
      : allItems;
    return createListCollection({
      items,
      itemToValue: (item) => item.value,
      itemToString: (item) => item.title,
    });
  }, [allItems, query]);

  const nothingToShow = hasError || (!isLoading && conversations.length === 0);
  if (nothingToShow) return trigger ? <>{trigger}</> : null;

  const searchable = allItems.length >= SEARCH_FROM;
  const atCeiling = conversations.length >= LANGY_LIST_MAX;

  return (
    <Combobox.Root
      collection={collection}
      openOnClick
      // History is navigation, not a value to hold: clear after each pick so
      // re-opening never lands pre-highlighted on a stale row.
      selectionBehavior="clear"
      onValueChange={(details) => {
        const id = details.value?.[0];
        if (id) onSelect(id);
      }}
      onInputValueChange={(details) => setQuery(details.inputValue)}
      onOpenChange={(details) => {
        if (details.open) setQuery("");
      }}
      positioning={{ placement, gutter: 6 }}
      width="auto"
    >
      {/* Ark anchors the listbox to the Control. Without it the popover lands in
          the viewport's top-left corner. */}
      <Combobox.Control display="flex" flex={1} minWidth={0}>
        {trigger ? (
          <Combobox.Trigger asChild>{trigger}</Combobox.Trigger>
        ) : (
          <Tooltip content="Recent chats" showArrow>
            <Combobox.Trigger asChild>
              <IconButton
                size="xs"
                variant="ghost"
                aria-label="Recent chats"
                color="fg.muted"
              >
                <History size={15} />
              </IconButton>
            </Combobox.Trigger>
          </Tooltip>
        )}
      </Combobox.Control>

      <Portal>
        <Combobox.Positioner>
          <Combobox.Content
            minWidth="300px"
            maxHeight="360px"
            overflowY="auto"
            padding={1}
            // Liquid-glass: translucent panel + backdrop blur, saturate<1 to
            // drain the colour out of whatever scrolls behind it.
            background="bg.panel/70"
            borderWidth="1px"
            borderColor="border.muted"
            boxShadow="lg"
            css={{
              backdropFilter: "blur(18px) saturate(0.5)",
              WebkitBackdropFilter: "blur(18px) saturate(0.5)",
            }}
          >
            {searchable ? (
              <Box
                position="sticky"
                top={0}
                zIndex={1}
                background="bg.panel"
                paddingBottom={1}
              >
                <Combobox.Input
                  autoFocus
                  placeholder="Search chats"
                  width="full"
                  height="32px"
                  paddingX={2.5}
                  borderRadius="md"
                  borderWidth="1px"
                  borderStyle="solid"
                  borderColor="border"
                  background="bg.subtle"
                  textStyle="sm"
                  color="fg"
                  _focusVisible={{
                    outline: "none",
                    borderColor: "orange.emphasized",
                  }}
                />
              </Box>
            ) : null}

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
            ) : null}

            <Combobox.Empty paddingX={2} paddingY={3}>
              <VStack align="start" gap={0.5}>
                <Text textStyle="xs" color="fg">
                  No chats match that search.
                </Text>
                <Text textStyle="2xs" color="fg.subtle">
                  Searching your {conversations.length} most recent chats.
                </Text>
              </VStack>
            </Combobox.Empty>

            {collection.items.map((item) => (
              <ChatRow
                key={item.value}
                item={item}
                onDelete={() => onDelete(item.value)}
              />
            ))}

            {/* Say what we can actually see. At the ceiling this is not
                "page 1 of N" — it is the whole list a client can obtain. */}
            {atCeiling ? (
              <Text
                textStyle="2xs"
                color="fg.subtle"
                paddingX={2}
                paddingY={1.5}
              >
                Showing your {LANGY_LIST_MAX} most recent chats.
              </Text>
            ) : null}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}

function ChatRow({ item, onDelete }: { item: ChatItem; onDelete: () => void }) {
  return (
    <Combobox.Item
      item={item}
      borderRadius="md"
      paddingX={2}
      paddingY={1.5}
      _hover={{ background: "bg.subtle", "& .row-delete": { opacity: 1 } }}
      _highlighted={{
        background: "bg.subtle",
        "& .row-delete": { opacity: 1 },
      }}
    >
      <HStack gap={2} width="full">
        <Combobox.ItemText css={{ flex: 1, minWidth: 0 }} truncate>
          <Box
            as="span"
            textStyle="sm"
            color={item.untitled ? "fg.muted" : "fg"}
            fontStyle={item.untitled ? "italic" : undefined}
          >
            {item.untitled ? (
              item.title
            ) : (
              <AnimatedConversationTitle title={item.title} />
            )}
          </Box>
        </Combobox.ItemText>
        <IconButton
          className="row-delete"
          size="2xs"
          variant="ghost"
          color="fg.subtle"
          aria-label="Delete conversation"
          // Hidden until the row is hovered or keyboard-highlighted — a column of
          // trash icons reads as noise. Focus restores it for keyboard users.
          opacity={0}
          _focusVisible={{ opacity: 1 }}
          transition="opacity 120ms"
          // Stop BOTH. Ark commits a Combobox selection on pointerdown, so
          // swallowing only the click would still open the chat you were trying
          // to delete, a frame before the delete ran.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
            onDelete();
          }}
        >
          <Trash2 size={12} />
        </IconButton>
      </HStack>
    </Combobox.Item>
  );
}
