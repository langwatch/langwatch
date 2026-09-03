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
import { ArrowLeft, Check, MoreHorizontal, Pencil, Search, Trash2, X } from "lucide-react";
import type React from "react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Menu } from "@langwatch/design-system/menu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { LangyConversationListItemDto } from "@langwatch/langy-contract";
import { useLangyConversationListQuery } from "../../behavior/data/use-langy-conversation-list-query";
import { formatLangyConversationDate } from "../../../../index";

/** A conversation whose title subscriber hasn't landed yet still needs a name. */
const UNTITLED = "Untitled chat";

/** Below this, a search field is more chrome than help. */
const SEARCH_FROM = 7;
const VIRTUALIZE_FROM = 50;
const CHAT_ROW_ESTIMATE = 60;

/** The day buckets the list groups under, newest first. */
type ChatGroup = "Today" | "Yesterday" | "This week" | "Older";

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * The day bucket a conversation's last activity falls in. Same start-of-day
 * arithmetic as `formatLangyConversationDate`, coarser buckets: rows sort
 * newest-first, so equal buckets are always contiguous and each one can carry
 * a single header.
 */
function chatGroupFor(timestampMs: number, nowMs = Date.now()): ChatGroup {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "Older";
  const date = new Date(timestampMs);
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((startOfToday - startOfDate) / DAY_MS);
  if (dayDifference <= 0) return "Today";
  if (dayDifference === 1) return "Yesterday";
  if (dayDifference < 7) return "This week";
  return "Older";
}

interface ChatItem {
  value: string;
  title: string;
  /** True when the title is a stand-in, so the row can say so quietly. */
  untitled: boolean;
  searchText: string;
  lastActivityAtMs: number;
  dateLabel: string;
  group: ChatGroup;
  messageCount: number;
}

/**
 * A render-stable wrapper for a handler prop: the returned function's identity
 * never changes, and calling it reaches the latest handler. This is what lets
 * the memoized rows below skip re-rendering when the panel above re-renders
 * with fresh inline closures — a page of thirty rows re-rendered three times
 * over on every list refresh without it (profiled at ~8ms per row).
 */
function useStableHandler<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  const ref = useRef(handler);
  useLayoutEffect(() => {
    ref.current = handler;
  });
  return useCallback((...args: A) => ref.current(...args), []);
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
    history.isFetched || history.items.length > 0 ? history.items : seededConversations;
  const isLoading = history.isLoading || (!history.isFetched && seededIsLoading);
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
          group: chatGroupFor(conversation.lastActivityAtMs),
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
    return q ? allItems.filter((item) => item.searchText.includes(q)) : allItems;
  }, [allItems, query]);

  const searchable = allItems.length >= SEARCH_FROM || history.hasNextPage || query.length > 0;

  // Every row handler below is render-stable (useCallback on setState only, or
  // useStableHandler around the panel's own inline closures), so the memoized
  // ChatRow only re-renders when ITS row's data or edit state changes.
  const selectChat = useStableHandler(onSelect);
  const deleteChat = useStableHandler(onDelete);
  const startRename = useCallback((item: ChatItem) => {
    setEditingId(item.value);
    setDraftTitle(item.untitled ? "" : item.title);
  }, []);
  const cancelRename = useCallback(() => {
    setEditingId(null);
    setDraftTitle("");
  }, []);
  const saveRename = useStableHandler(async () => {
    if (!editingId || !draftTitle.trim()) return;
    setSavingId(editingId);
    try {
      await onRename(editingId, draftTitle);
      cancelRename();
    } finally {
      setSavingId(null);
    }
  });

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
        <Box paddingX={pad} paddingBottom={3}>
          <HStack
            gap={2}
            paddingX={2.5}
            paddingY={1.5}
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
        <HStack gap={2} paddingX={pad} paddingY={1.5} aria-label="Loading recent conversations">
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
        renderItem={(item, showDate) => (
          <ChatRow
            key={item.value}
            item={item}
            showDate={showDate}
            isActive={item.value === activeConversationId}
            onSelect={selectChat}
            onDelete={deleteChat}
            onStartRename={startRename}
            editing={editingId === item.value}
            // Only the row being renamed sees the draft; a constant for the
            // rest, so typing a title re-renders one row, not the page.
            draftTitle={editingId === item.value ? draftTitle : ""}
            saving={savingId === item.value}
            onDraftTitleChange={setDraftTitle}
            onSaveRename={saveRename}
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
            {history.isFetchingNextPage ? <Spinner size="xs" /> : "Load older chats"}
          </Button>
        </Box>
      ) : history.isFetchingNextPage ? (
        <HStack justify="center" paddingY={2} aria-label="Loading older conversations">
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
 *
 * The non-virtual path (the common case) groups rows under quiet day headers;
 * rows in Today/Yesterday drop their own date, since the header already says
 * it. The virtual path stays a flat list — absolute-positioned rows cannot
 * interleave headers without measuring them too — so there every row keeps its
 * date, which is what `showDate` tells the row.
 */
function ChatRows({
  items,
  paddingX,
  renderItem,
}: {
  items: ChatItem[];
  paddingX: string;
  renderItem: (item: ChatItem, showDate: boolean) => React.ReactNode;
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
                {renderItem(item, true)}
              </Box>
            );
          })}
        </Box>
      ) : (
        items.map((item, index) => {
          const startsGroup = item.group !== items[index - 1]?.group;
          const headerHidesDate = item.group === "Today" || item.group === "Yesterday";
          return (
            <Fragment key={item.value}>
              {startsGroup ? (
                // The header is presentation: every row already carries its
                // date in its own accessible name, so screen readers keep an
                // uninterrupted list of items.
                <Text
                  aria-hidden="true"
                  textStyle="2xs"
                  fontWeight="600"
                  color="fg.subtle"
                  textTransform="uppercase"
                  letterSpacing="0.06em"
                  paddingX={2}
                  paddingTop={index === 0 ? 1 : 4}
                  paddingBottom={1.5}
                >
                  {item.group}
                </Text>
              ) : null}
              {renderItem(item, !headerHidesDate)}
            </Fragment>
          );
        })
      )}
    </Box>
  );
}

// Memoized: the list re-renders on every query notify and panel re-render, and
// a page of thirty un-memoized rows (each with its own actions menu) was the
// dominant cost of opening history. All handlers are render-stable (see above),
// so a row only re-renders when its own item, active flag or edit state moves.
const ChatRow = memo(function ChatRow({
  item,
  showDate,
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
  /** False when a group header above the row already names the day. */
  showDate: boolean;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onStartRename: (item: ChatItem) => void;
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
        <HStack gap={1} flex={1} minWidth={0} paddingX={2} paddingY={1.5}>
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
          onClick={() => onSelect(item.value)}
          // Named EXPLICITLY: the label is what a screen reader announces and
          // what a test can find the row by. It always carries the date, even
          // when the visible row leaves it to the group header above.
          aria-label={`${item.title}, ${item.dateLabel}`}
          flex={1}
          minWidth={0}
          textAlign="left"
          paddingX={2}
          paddingY={1.5}
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
            {/* Plain truncated text, deliberately NOT AnimatedConversationTitle:
                the letter-by-letter reveal builds two components per character,
                and a page of thirty titles paid ~1,500 component mounts for an
                animation that only means something where a title visibly
                changes — the panel header. */}
            <Box
              as="span"
              display="block"
              fontSize="13px"
              lineHeight="1.25"
              fontWeight={isActive ? "600" : undefined}
              color={item.untitled ? "fg.muted" : "fg"}
              fontStyle={item.untitled ? "italic" : undefined}
              whiteSpace="nowrap"
              overflow="hidden"
              textOverflow="ellipsis"
              title={item.title}
            >
              {item.title}
            </Box>
            {showDate || item.messageCount > 0 ? (
              <HStack gap={1.5} color="fg.subtle" minWidth={0}>
                {showDate ? (
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
                ) : null}
                {item.messageCount > 0 ? (
                  <Text textStyle="2xs" truncate>
                    {showDate ? "· " : ""}
                    {item.messageCount.toLocaleString()} messages
                  </Text>
                ) : null}
              </HStack>
            ) : null}
          </VStack>
        </chakra.button>
      )}
      {/* lazyMount + unmountOnExit: a page of rows must not mount thirty menu
          subtrees nobody has opened — the content renders on first open. */}
      <Menu.Root positioning={{ placement: "bottom-end", gutter: 4 }} lazyMount unmountOnExit>
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
          <Menu.Item value="rename" onClick={() => onStartRename(item)}>
            <Pencil size={14} /> Rename
          </Menu.Item>
          {/* No "Fork chat". The mutation still exists server-side
              (`langy.forkConversation`), but branching a conversation is not
              something the panel offers: it doubled the list with
              near-identical titles nobody could tell apart. */}
          <Menu.Separator />
          <Menu.Item value="delete" color="fg.error" onClick={() => onDelete(item.value)}>
            <Trash2 size={14} /> Delete
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </HStack>
  );
});
