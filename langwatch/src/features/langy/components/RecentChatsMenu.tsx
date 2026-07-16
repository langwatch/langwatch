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
 * Results are keyset-paginated and title search runs on the server. The list
 * renders one bounded page at a time and lets the user explicitly load older
 * rows, avoiding a large eager DOM without weakening keyboard listbox behavior.
 */
import {
  Box,
  Button,
  Combobox,
  chakra,
  createListCollection,
  HStack,
  IconButton,
  Input,
  Portal,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Check,
  CopyPlus,
  History,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Tooltip } from "~/components/ui/tooltip";
import { Menu } from "~/components/ui/menu";
import type { LangyConversationListItemDto } from "../data/langy.dtos";
import { useLangyConversationListQuery } from "../data/useLangyConversationListQuery";
import { formatLangyConversationDate } from "../logic/langyConversationDate";
import { AnimatedConversationTitle } from "./AnimatedConversationTitle";
import { LangyComboboxSearch } from "./LangyComboboxSearch";

/** A conversation whose title reactor hasn't landed yet still needs a name. */
const UNTITLED = "Untitled chat";

/** Below this, a search field is more chrome than help. */
const SEARCH_FROM = 7;
const VIRTUALIZE_FROM = 50;
const CHAT_ROW_ESTIMATE = 58;
const MotionBox = motion.create(Box);

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

export function RecentChatsMenu({
  conversations: seededConversations,
  isLoading: seededIsLoading,
  hasError: seededHasError,
  onSelect,
  onDelete,
  onFork,
  onRename,
  trigger,
  placement = "bottom-end",
}: {
  conversations: LangyConversationListItemDto[];
  isLoading: boolean;
  hasError: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onFork: (id: string) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  /**
   * Host the listbox on a caller-supplied trigger instead of the default History
   * icon-button. When one is given and there is nothing to list, it renders BARE
   * — a caller that hands over its title must always get its title back.
   */
  trigger?: React.ReactNode;
  placement?: "bottom-end" | "bottom-start";
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [forkingId, setForkingId] = useState<string | null>(null);
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

  // Only a FAILED list hides the menu (the panel surfaces that as its own
  // error card). An empty list is a normal day one — the menu opens and says
  // so, calmly, instead of hiding or spinning.
  if (hasError) return trigger ? <>{trigger}</> : null;

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
  const fork = async (id: string) => {
    setForkingId(id);
    try {
      await onFork(id);
    } finally {
      setForkingId(null);
    }
  };

  return (
    <Combobox.Root
      collection={collection}
      inputValue={query}
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
      // When hosted on a caller's trigger (the header title), grow to fill the
      // row AND allow shrinking below the title's intrinsic width — that is what
      // lets the title ellipsis-truncate instead of shoving the header controls
      // off the panel's edge. The bare icon-trigger form stays intrinsic.
      flex={trigger ? "1 1 0%" : undefined}
      minWidth={trigger ? 0 : undefined}
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
            width="min(340px, calc(100vw - 24px))"
            maxHeight="360px"
            overflow="hidden"
            padding={0}
            borderRadius="12px"
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
              // Keep a native input listener alongside Ark's value callback:
              // it also covers IME and browser autofill input events.
              <Box
                onInputCapture={(event) => {
                  if (event.target instanceof HTMLInputElement) {
                    setQuery(event.target.value);
                  }
                }}
              >
                <LangyComboboxSearch placeholder="Search chats" />
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

            {/* While loading the spinner speaks alone — an empty message next
                to a spinner reads as two states at once. Loaded and empty is
                either a fresh account (calm, expected) or a search with no
                hits — each gets its own words. */}
            {!isLoading ? (
              <Combobox.Empty paddingX={2} paddingY={3}>
                {query.trim().length === 0 && conversations.length === 0 ? (
                  <VStack align="start" gap={0.5}>
                    <Text textStyle="xs" color="fg">
                      No conversations yet.
                    </Text>
                    <Text textStyle="2xs" color="fg.subtle">
                      Chats with Langy will show up here.
                    </Text>
                  </VStack>
                ) : (
                  <VStack align="start" gap={0.5}>
                    <Text textStyle="xs" color="fg">
                      No chats match that search.
                    </Text>
                    <Text textStyle="2xs" color="fg.subtle">
                      Try a different conversation title.
                    </Text>
                  </VStack>
                )}
              </Combobox.Empty>
            ) : null}

            <VirtualizedChatRows
              items={collection.items}
              renderItem={(item) => (
                <ChatRow
                  key={item.value}
                  item={item}
                  onDelete={() => onDelete(item.value)}
                  onFork={() => void fork(item.value)}
                  forking={forkingId === item.value}
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
              <Box paddingX={1} paddingBottom={1}>
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
                paddingX={2}
                paddingY={1.5}
                aria-label="Loading older conversations"
              >
                <Spinner size="xs" />
              </HStack>
            ) : null}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}

/**
 * Recents are keyset-paginated, but a person can deliberately load many pages.
 * Once that happens, keep the actual listbox DOM bounded while preserving the
 * same combobox items, row actions, and keyboard semantics for nearby rows.
 */
function VirtualizedChatRows({
  items,
  renderItem,
}: {
  items: ChatItem[];
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
      maxHeight="270px"
      overflowY="auto"
      overscrollBehavior="contain"
      padding={1}
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
  onDelete,
  onFork,
  forking,
  onStartRename,
  editing,
  draftTitle,
  saving,
  onDraftTitleChange,
  onSaveRename,
  onCancelRename,
}: {
  item: ChatItem;
  onDelete: () => void;
  onFork: () => void;
  forking: boolean;
  onStartRename: () => void;
  editing: boolean;
  draftTitle: string;
  saving: boolean;
  onDraftTitleChange: (title: string) => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
}) {
  return (
    <Combobox.Item
      item={item}
      position="relative"
      overflow="hidden"
      borderRadius="md"
      paddingX={2}
      paddingY={1.25}
      _hover={{ background: "bg.subtle", "& .row-delete": { opacity: 1 } }}
      _highlighted={{
        background: "bg.subtle",
        "& .row-delete": { opacity: 1 },
      }}
    >
      <HStack gap={2} width="full" align="center">
        <VStack align="stretch" gap={0.5} flex={1} minWidth={0}>
          {editing ? (
            <HStack
              gap={1}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
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
                  if (event.key === "Escape") onCancelRename();
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
            <Combobox.ItemText css={{ minWidth: 0 }} truncate>
              <Box
                as="span"
                fontSize="13px"
                lineHeight="1.25"
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
          )}
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
        <Menu.Root positioning={{ placement: "right-start", gutter: 4 }}>
          <Menu.Trigger asChild>
            <IconButton
              className="row-delete"
              size="2xs"
              variant="ghost"
              color="fg.subtle"
              aria-label="Conversation actions"
              opacity={0}
              _focusVisible={{ opacity: 1 }}
              transition="opacity 120ms"
              // Ark commits a Combobox selection on pointerdown. Keep row
              // actions independent from opening the conversation.
              onPointerDown={(event) => event.stopPropagation()}
            >
              <MoreHorizontal size={14} />
            </IconButton>
          </Menu.Trigger>
          <Menu.Content minWidth="152px">
            <Menu.Item value="rename" onClick={onStartRename}>
              <Pencil size={14} /> Rename
            </Menu.Item>
            <Menu.Item value="fork" onClick={onFork}>
              <CopyPlus size={14} /> Fork chat
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item value="delete" color="fg.error" onClick={onDelete}>
              <Trash2 size={14} /> Delete
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </HStack>
      <AnimatePresence>
        {forking ? (
          <MotionBox
            position="absolute"
            inset={0}
            display="flex"
            alignItems="center"
            gap={2}
            paddingX={3}
            background="bg.panel/94"
            color="orange.fg"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            pointerEvents="none"
            aria-live="polite"
          >
            <MotionBox
              display="grid"
              placeItems="center"
              initial={{ scale: 0.82, x: -5 }}
              animate={{ scale: [0.82, 1, 0.96], x: [-5, 3, 0] }}
              transition={{ duration: 0.48, ease: "easeOut" }}
            >
              <CopyPlus size={16} />
            </MotionBox>
            <Text textStyle="xs" fontWeight="600">
              Cloning chat…
            </Text>
          </MotionBox>
        ) : null}
      </AnimatePresence>
    </Combobox.Item>
  );
}
