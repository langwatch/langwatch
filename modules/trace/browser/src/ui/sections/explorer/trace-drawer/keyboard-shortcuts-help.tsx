import { Dialog } from "@langwatch/design-system/dialog";
import { Box, Text, VStack } from "@langwatch/design-system/primitives";
import { SearchInput } from "@langwatch/design-system/search-input";
import { ShortcutHint, type ShortcutDefinition } from "@langwatch/design-system/shortcut-hint";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type ShortcutHelpGroup,
  type ShortcutHelpItem,
  TRACE_DRAWER_HELP_GROUPS,
} from "../../../../features/trace-drawer/behavior/trace-drawer-shortcut-table.ts";

export type ShortcutGroup = ShortcutHelpGroup;

const NOT_FOUND = "No shortcuts match. Try an action such as Refresh or Find.";

const KEY_ALIASES: Record<string, string> = {
  Escape: "esc escape",
  Enter: "enter return",
  ArrowLeft: "left arrow",
  ArrowRight: "right arrow",
  ArrowUp: "up arrow",
  ArrowDown: "down arrow",
  Control: "ctrl control",
  Meta: "cmd command",
  " ": "space",
  "?": "question mark",
  "\\": "backslash",
};

const FOCUSED_CONTROLS: ShortcutGroup = {
  title: "Focused controls",
  items: [
    {
      label: "Move between span tabs",
      shortcut: { alternatives: [{ keys: ["ArrowLeft"] }, { keys: ["ArrowRight"] }] },
      scope: "When a span tab is focused",
    },
    {
      label: "First or last span tab",
      shortcut: { alternatives: [{ keys: ["Home"] }, { keys: ["End"] }] },
      scope: "When a span tab is focused",
    },
    {
      label: "Open the focused span tab",
      shortcut: { alternatives: [{ keys: ["Enter"] }, { keys: [" "] }] },
      scope: "When a span tab is focused",
    },
    {
      label: "Move between spans",
      shortcut: {
        alternatives: [
          { keys: ["ArrowUp"] },
          { keys: ["ArrowDown"] },
          { keys: ["ArrowLeft"] },
          { keys: ["ArrowRight"] },
        ],
      },
      scope: "When the flame graph is focused",
    },
    {
      label: "Pan the flame graph",
      shortcut: {
        alternatives: [{ keys: ["Shift", "ArrowLeft"] }, { keys: ["Shift", "ArrowRight"] }],
      },
      scope: "When the flame graph is focused",
    },
    {
      label: "Select the focused span",
      shortcut: { alternatives: [{ keys: ["Enter"] }, { keys: [" "] }] },
      scope: "When the flame graph is focused",
    },
    {
      label: "Zoom in or out",
      shortcut: { alternatives: [{ keys: ["+"] }, { keys: ["-"] }] },
      scope: "When the flame graph is focused",
    },
    {
      label: "Reset zoom",
      shortcut: { alternatives: [{ keys: ["0"] }, { keys: ["Home"] }] },
      scope: "When the flame graph is focused",
    },
  ],
};

const DRAWER_GROUPS: ShortcutGroup[] = [...TRACE_DRAWER_HELP_GROUPS, FOCUSED_CONTROLS];

function keyWords(shortcut: ShortcutDefinition | undefined): string[] {
  if (!shortcut) return [];
  return shortcut.alternatives.flatMap((chord) =>
    chord.keys.flatMap((key) => [key, KEY_ALIASES[key] ?? ""]),
  );
}

function searchText({ group, item }: { group: string; item: ShortcutHelpItem }): string {
  return [group, item.label, item.detail, item.scope, item.gesture, ...keyWords(item.shortcut)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function filterGroups({
  groups,
  query,
}: {
  groups: ShortcutGroup[];
  query: string;
}): ShortcutGroup[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return groups;
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const text = searchText({ group: group.title, item });
        return terms.every((term) => text.includes(term));
      }),
    }))
    .filter((group) => group.items.length > 0);
}

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
  /** Override the shortcut groups shown. Defaults to the trace drawer set. */
  groups?: ShortcutGroup[];
  /** Where focus lands if the control that opened this has since unmounted. */
  fallbackFocusSelector?: string;
}

function ShortcutRow({ item }: { item: ShortcutHelpItem }) {
  return (
    <Box as="li" display="flex" gap={3} justifyContent="space-between" alignItems="flex-start">
      <VStack align="start" gap={0} flex="1" minWidth={0}>
        <Text textStyle="xs" color="fg" lineHeight="1.4">
          {item.label}
        </Text>
        {item.scope ? (
          <Text textStyle="2xs" color="fg.muted" lineHeight="1.3">
            {item.scope}
          </Text>
        ) : null}
        {item.detail ? (
          <Text textStyle="2xs" color="fg.muted" lineHeight="1.3">
            {item.detail}
          </Text>
        ) : null}
      </VStack>
      {item.shortcut ? (
        <ShortcutHint shortcut={item.shortcut} />
      ) : (
        <Text textStyle="2xs" color="fg.muted" flexShrink={0}>
          {item.gesture}
        </Text>
      )}
    </Box>
  );
}

export function KeyboardShortcutsHelp({
  open,
  onClose,
  groups = DRAWER_GROUPS,
  fallbackFocusSelector,
}: KeyboardShortcutsHelpProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  if (open && openerRef.current === null && document.activeElement instanceof HTMLElement) {
    openerRef.current = document.activeElement;
  }

  useEffect(() => {
    if (open) return;
    setQuery("");
    openerRef.current = null;
  }, [open]);

  const visible = useMemo(() => filterGroups({ groups, query }), [groups, query]);

  const returnFocusTo = () => {
    const opener = openerRef.current;
    if (opener?.isConnected) return opener;
    return fallbackFocusSelector
      ? document.querySelector<HTMLElement>(fallbackFocusSelector)
      : null;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      size="sm"
      heightLimit="reading"
      body="flush"
      cancelLabel={null}
      initialFocusEl={() => inputRef.current}
      finalFocusEl={returnFocusTo}
      data-testid="keyboard-shortcuts-help"
    >
      <Box paddingX={5} paddingY={3}>
        <SearchInput
          ref={inputRef}
          aria-label="Find a shortcut"
          placeholder="Find a shortcut"
          size="sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Box>
      <Box paddingX={5} paddingBottom={4} maxHeight="60vh" overflowY="auto">
        {visible.length === 0 ? (
          <Text as="output" textStyle="xs" color="fg.muted">
            {NOT_FOUND}
          </Text>
        ) : (
          <VStack align="stretch" gap={4}>
            {visible.map((group) => (
              <Box as="section" key={group.title} aria-label={group.title}>
                <Text
                  as="h3"
                  textStyle="2xs"
                  color="fg.muted"
                  fontWeight="semibold"
                  textTransform="uppercase"
                  letterSpacing="0.04em"
                  marginBottom={1.5}
                >
                  {group.title}
                </Text>
                <VStack
                  as="ul"
                  align="stretch"
                  gap={1.5}
                  listStyleType="none"
                  margin={0}
                  padding={0}
                >
                  {group.items.map((item) => (
                    <ShortcutRow key={`${item.label}-${item.scope ?? ""}`} item={item} />
                  ))}
                </VStack>
              </Box>
            ))}
          </VStack>
        )}
      </Box>
    </Dialog>
  );
}
