/**
 * Langy's conversation history, as a FULL VIEW inside the panel.
 *
 * It used to be a 340px popover hanging off the header's History icon. In a
 * panel that is itself only ~420px wide, that meant a small floating list on top
 * of the conversation it was covering — a window inside a window, with the chat
 * showing round the edges of the thing you were trying to read. History is not a
 * quick pick from a menu; it is a place you go. So the list now REPLACES the
 * message column (the same swap the card gallery and the inline model setup
 * already do), and the header's History control toggles you in and out.
 *
 * WHY NOT `Combobox` ANY MORE: the popover was built on Ark's `Combobox`
 * specifically to get listbox keyboard semantics — roving focus,
 * `aria-activedescendant`, ↑/↓ to move, Enter to select — which you otherwise
 * have to hand-roll inside a `Menu`. A full-height view needs none of that: the
 * rows are ordinary buttons in a scroll container, so Tab order, Enter/Space and
 * screen-reader list semantics all come from the platform. Fighting Ark to
 * render a permanently-open combobox inline would have been more machinery for
 * less correctness. (`LangyModelPill` still uses the combobox, where it belongs:
 * that one really is a value picker in a popover.)
 *
 * Results are keyset-paginated and title search runs on the server. The list
 * renders one bounded page at a time and lets the user explicitly load older
 * rows; past a threshold the rows virtualize so a deliberately deep history
 * cannot put thousands of nodes in the DOM.
 */
import {
  Box,
  Button,
  chakra,
  HStack,
  IconButton,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  Check,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import type { LangyConversationListItemDto } from "../data/langy.dtos";
import { useLangyConversationListQuery } from "../data/useLangyConversationListQuery";
import { formatLangyConversationDate } from "../logic/langyConversationDate";
import { AnimatedConversationTitle } from "./AnimatedConversationTitle";

/** A conversation whose title reactor hasn't landed yet still needs a name. */
const UNTITLED = "Untitled chat";

/** Below this, a search field is more chrome than help. */
const SEARCH_FROM = 7;
const VIRTUALIZE_FROM = 50;
const CHAT_ROW_ESTIMATE = 58;

interface ChatItem {
  value: string;
  title: string;
  /** True when the title is a stand-in, so the row can say so quietly. */
  untitled: boolean;
  searchText: string;
  lastActivityAtMs: number;
  dateLabel: string;
  messageCount: number;
}

export function RecentChatsView({
  conversations: seededConversations,
  isLoading: seededIsLoading,
  hasError: seededHasError,
  activeConversationId,
  onSelect,
  onDelete,
  onRename,
  onBack,
  compact = false,
}: {
  conversations: LangyConversationListItemDto[];
  isLoading: boolean;
  hasError: boolean;
  /** Marked as current, so you can see where you already are. */
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  /** Leave the list and return to the conversation. */
  onBack: () => void;
  /** The narrower docked sidebar runs a little denser. */
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);
  // LangyPanel already observes this query for the header title. The blank
  // search therefore shares the exact same React Query cache; only a real
  // search creates a distinct server request.
  const history = useLangyConversationListQuery(debouncedQuery);
  const conversations =
    history.isFetched || history.items.length > 0
      ? history.items
      : seededConversations;
  const isLoading =
    history.isLoading || (!history.isFetched && seededIsLoading);
  const hasError = seededHasError || history.isError;

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
          lastActivityAtMs: conversation.lastActivityAtMs,
          dateLabel: formatLangyConversationDate(conversation.lastActivityAtMs),
          messageCount: conversation.messageCount,
        };
      }),
    [conversations],
  );

  // Rebuilt per keystroke from the CURRENT items — the list arrives async, so a
  // one-shot snapshot would freeze it empty. The server also filters, but
  // filtering locally too keeps the list responsive inside the debounce window.
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? allItems.filter((item) => item.searchText.includes(q))
      : allItems;
  }, [allItems, query]);

  const searchable =
    allItems.length >= SEARCH_FROM || history.hasNextPage || query.length > 0;

  const startRename = (item: ChatItem) => {
    setEditingId(item.value);
    setDraftTitle(item.untitled ? "" : item.title);
  };
  const cancelRename = () => {
    setEditingId(null);
    setDraftTitle("");
  };
  const saveRename = async () => {
    if (!editingId || !draftTitle.trim()) return;
    setSavingId(editingId);
    try {
      await onRename(editingId, draftTitle);
      cancelRename();
    } finally {
      setSavingId(null);
    }
  };

  const pad = compact ? "14px" : "19px";

  return (
    <VStack
      align="stretch"
      gap={0}
      flex={1}
      minHeight={0}
      // Escape anywhere in the view is the way back — the same reflex the
      // popover trained, kept now that the list is a place rather than an
      // overlay.
      onKeyDown={(event) => {
        if (event.key === "Escape" && !editingId) {
          event.preventDefault();
          onBack();
        }
      }}
    >
      <HStack gap={2} paddingX={pad} paddingTop={pad} paddingBottom={2}>
        <Tooltip content="Back to chat" positioning={{ placement: "bottom" }}>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label="Back to chat"
            color="fg.muted"
            onClick={onBack}
          >
            <ArrowLeft size={15} />
          </IconButton>
        </Tooltip>
        <Text textStyle="sm" fontWeight="600" color="fg">
          Recent chats
        </Text>
      </HStack>

      {searchable ? (
        <Box paddingX={pad} paddingBottom={2}>
          <HStack
            gap={2}
            paddingX={2.5}
            paddingY={1}
            borderWidth="1px"
            borderStyle="solid"
            borderColor="border.emphasized"
            borderRadius="lg"
            background="bg.subtle"
          >
            <Box color="fg.subtle" display="grid" placeItems="center">
              <Search size={13} />
            </Box>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              size="xs"
              border="none"
              background="transparent"
              paddingX={0}
              _focus={{ outline: "none", boxShadow: "none" }}
              _focusVisible={{ outline: "none", boxShadow: "none" }}
            />
          </HStack>
        </Box>
      ) : null}

      {isLoading ? (
        <HStack
          gap={2}
          paddingX={pad}
          paddingY={1.5}
          aria-label="Loading recent conversations"
        >
          <Spinner size="xs" />
          <Text textStyle="xs" color="fg.muted">
            Loading…
          </Text>
        </HStack>
      ) : null}

      {/* While loading the spinner speaks alone — an empty message next to a
          spinner reads as two states at once. Loaded and empty is either a
          fresh account (calm, expected) or a search with no hits; each gets
          its own words. A FAILED list is owned by the panel, which surfaces
          its own dismissable error card above this view. */}
      {!isLoading && !hasError && items.length === 0 ? (
        <VStack align="start" gap={0.5} paddingX={pad} paddingY={3}>
          {query.trim().length === 0 ? (
            <>
              <Text textStyle="xs" color="fg">
                No conversations yet.
              </Text>
              <Text textStyle="2xs" color="fg.subtle">
                Chats with Langy will show up here.
              </Text>
            </>
          ) : (
            <>
              <Text textStyle="xs" color="fg">
                No chats match that search.
              </Text>
              <Text textStyle="2xs" color="fg.subtle">
                Try a different conversation title.
              </Text>
            </>
          )}
        </VStack>
      ) : null}

      <ChatRows
        items={items}
        paddingX={pad}
        renderItem={(item) => (
          <ChatRow
            key={item.value}
            item={item}
            isActive={item.value === activeConversationId}
            onSelect={() => onSelect(item.value)}
            onDelete={() => onDelete(item.value)}
            onStartRename={() => startRename(item)}
            editing={editingId === item.value}
            draftTitle={draftTitle}
            saving={savingId === item.value}
            onDraftTitleChange={setDraftTitle}
            onSaveRename={() => void saveRename()}
            onCancelRename={cancelRename}
          />
        )}
      />

      {history.hasNextPage ? (
        <Box paddingX={pad} paddingY={2}>
          <Button
            width="full"
            size="xs"
            variant="ghost"
            color="fg.muted"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
            aria-label="Load older conversations"
          >
            {history.isFetchingNextPage ? (
              <Spinner size="xs" />
            ) : (
              "Load older chats"
            )}
          </Button>
        </Box>
      ) : history.isFetchingNextPage ? (
        <HStack
          justify="center"
          paddingY={2}
          aria-label="Loading older conversations"
        >
          <Spinner size="xs" />
        </HStack>
      ) : null}
    </VStack>
  );
}

/**
 * The scrolling body of the list.
 *
 * Recents are keyset-paginated, but a person can deliberately load many pages.
 * Once that happens, keep the actual DOM bounded while preserving the same rows
 * and row actions for everything on screen.
 */
function ChatRows({
  items,
  paddingX,
  renderItem,
}: {
  items: ChatItem[];
  paddingX: string;
  renderItem: (item: ChatItem) => React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CHAT_ROW_ESTIMATE,
    getItemKey: (index) => items[index]?.value ?? index,
    overscan: 8,
    enabled: items.length > VIRTUALIZE_FROM,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const isVirtual = items.length > VIRTUALIZE_FROM;

  return (
    <Box
      ref={scrollRef}
      role="list"
      aria-label="Recent chats"
      flex={1}
      minHeight={0}
      overflowY="auto"
      overscrollBehavior="contain"
      paddingX={paddingX}
      paddingBottom={2}
    >
      {isVirtual ? (
        <Box height={`${virtualizer.getTotalSize()}px`} position="relative">
          {virtualItems.map((virtualItem) => {
            const item = items[virtualItem.index];
            if (!item) return null;
            return (
              <Box
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                position="absolute"
                top={0}
                left={0}
                width="full"
                transform={`translateY(${virtualItem.start}px)`}
              >
                {renderItem(item)}
              </Box>
            );
          })}
        </Box>
      ) : (
        items.map(renderItem)
      )}
    </Box>
  );
}

function ChatRow({
  item,
  isActive,
  onSelect,
  onDelete,
  onStartRename,
  editing,
  draftTitle,
  saving,
  onDraftTitleChange,
  onSaveRename,
  onCancelRename,
}: {
  item: ChatItem;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onStartRename: () => void;
  editing: boolean;
  draftTitle: string;
  saving: boolean;
  onDraftTitleChange: (title: string) => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
}) {
  return (
    // The row is a CONTAINER with two sibling controls, never one button
    // wrapping another: the title opens the conversation, the ⋯ opens the row
    // actions. Nesting them would be invalid markup and would make the actions
    // unreachable by keyboard.
    <HStack
      role="listitem"
      gap={1}
      width="full"
      align="center"
      borderRadius="md"
      paddingRight={1}
      _hover={{ background: "bg.subtle", "& .row-actions": { opacity: 1 } }}
      css={{ "&:focus-within .row-actions": { opacity: 1 } }}
      {...(isActive ? { background: "bg.subtle" } : {})}
    >
      {editing ? (
        <HStack gap={1} flex={1} minWidth={0} paddingX={2} paddingY={1.25}>
          <Input
            size="xs"
            autoFocus
            aria-label="Conversation title"
            value={draftTitle}
            onChange={(event) => onDraftTitleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSaveRename();
              }
              // Stop Escape here: it cancels the rename, it does not leave the
              // view (the container handles that when nothing is being edited).
              if (event.key === "Escape") {
                event.stopPropagation();
                onCancelRename();
              }
            }}
          />
          <IconButton
            size="2xs"
            variant="ghost"
            aria-label="Save title"
            disabled={!draftTitle.trim() || saving}
            onClick={onSaveRename}
          >
            <Check size={13} />
          </IconButton>
          <IconButton
            size="2xs"
            variant="ghost"
            aria-label="Cancel rename"
            onClick={onCancelRename}
          >
            <X size={13} />
          </IconButton>
        </HStack>
      ) : (
        <chakra.button
          type="button"
          onClick={onSelect}
          // Named EXPLICITLY, never by its own content: AnimatedConversationTitle
          // splits the title into one span per character so it can blur-reveal
          // letter by letter, and a name computed from that DOM comes out as
          // "O l d e r  c h a t". The label is what a screen reader announces
          // and what a test can find the row by, so it must be the real title.
          aria-label={`${item.title}, ${item.dateLabel}`}
          flex={1}
          minWidth={0}
          textAlign="left"
          paddingX={2}
          paddingY={1.25}
          borderRadius="md"
          borderWidth={0}
          background="transparent"
          cursor="pointer"
          {...(isActive ? { "aria-current": "true" } : {})}
          _focusVisible={{
            outline: "2px solid",
            outlineColor: "orange.focusRing",
            outlineOffset: "-2px",
          }}
        >
          <VStack align="stretch" gap={0.5} minWidth={0}>
            <Box
              as="span"
              display="block"
              fontSize="13px"
              lineHeight="1.25"
              color={item.untitled ? "fg.muted" : "fg"}
              fontStyle={item.untitled ? "italic" : undefined}
              whiteSpace="nowrap"
              overflow="hidden"
              textOverflow="ellipsis"
            >
              {item.untitled ? (
                item.title
              ) : (
                <AnimatedConversationTitle title={item.title} />
              )}
            </Box>
            <HStack gap={1} color="fg.subtle" minWidth={0}>
              <chakra.time
                dateTime={
                  item.lastActivityAtMs > 0
                    ? new Date(item.lastActivityAtMs).toISOString()
                    : undefined
                }
                textStyle="2xs"
                whiteSpace="nowrap"
              >
                {item.dateLabel}
              </chakra.time>
              {item.messageCount > 0 ? (
                <Text textStyle="2xs" truncate>
                  · {item.messageCount.toLocaleString()} messages
                </Text>
              ) : null}
            </HStack>
          </VStack>
        </chakra.button>
      )}
      <Menu.Root positioning={{ placement: "bottom-end", gutter: 4 }}>
        <Menu.Trigger asChild>
          <IconButton
            className="row-actions"
            size="2xs"
            variant="ghost"
            color="fg.subtle"
            aria-label="Conversation actions"
            opacity={0}
            _focusVisible={{ opacity: 1 }}
            transition="opacity 120ms"
            flexShrink={0}
          >
            <MoreHorizontal size={14} />
          </IconButton>
        </Menu.Trigger>
        <Menu.Content minWidth="152px">
          <Menu.Item value="rename" onClick={onStartRename}>
            <Pencil size={14} /> Rename
          </Menu.Item>
          {/* No "Fork chat". The mutation still exists server-side
              (`langy.forkConversation`), but branching a conversation is not
              something the panel offers: it doubled the list with
              near-identical titles nobody could tell apart. */}
          <Menu.Separator />
          <Menu.Item value="delete" color="fg.error" onClick={onDelete}>
            <Trash2 size={14} /> Delete
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </HStack>
  );
}
