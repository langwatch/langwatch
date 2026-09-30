/**
 * Click-to-edit widget name, shared by every surface that shows one: the
 * edit drawer's own header, a playground card's title, a pinned widget's
 * title on a dashboard card. Same pattern `AnalyticsHeader` uses for a
 * dashboard's own name: a flushed `Input` while editing (auto-focused,
 * auto-selected), a pencil icon that fades in on hover otherwise. Commits
 * on blur/Enter, discards on Escape — `onRename` is only called with a
 * real, non-empty change, never on every keystroke.
 *
 * `name` is always the full underlying value (editing starts from it, even
 * on a surface that only *displays* something derived from it, like the
 * dashboard's own prefix-stripped `displayText` — editing the stripped text
 * directly would silently drop the "North-star:"/"Legacy:" prefix on save).
 *
 * The id is shown in a tooltip, not inline — a member copying a widget id
 * for the CLI/REST API needs to find it somewhere, but it's not something
 * to read at a glance next to the name, so it stays a hover affordance
 * rather than permanent on-card text.
 */

import { Box, HStack, Input, Text } from "@chakra-ui/react";
import { Edit2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Tooltip } from "~/components/ui/tooltip";

interface EditableWidgetNameInputProps {
  draft: string;
  setDraft: (value: string) => void;
  finishEdit: () => void;
  cancelEdit: () => void;
  fontSize: string;
  fontWeight: string;
}

function EditableWidgetNameInput({
  draft,
  setDraft,
  finishEdit,
  cancelEdit,
  fontSize,
  fontWeight,
}: EditableWidgetNameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <Input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finishEdit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finishEdit();
        if (e.key === "Escape") cancelEdit();
      }}
      onClick={(e) => e.stopPropagation()}
      fontSize={fontSize}
      fontWeight={fontWeight}
      variant="flushed"
      width="auto"
      minWidth="160px"
    />
  );
}

interface EditableWidgetNameDisplayProps {
  name: string;
  displayText?: string;
  id?: string;
  startEdit: () => void;
  fontSize: string;
  fontWeight: string;
  shouldTruncate: boolean;
}

function EditableWidgetNameDisplay({
  name,
  displayText,
  id,
  startEdit,
  fontSize,
  fontWeight,
  shouldTruncate,
}: EditableWidgetNameDisplayProps) {
  return (
    <Tooltip
      content={id ? `ID: ${id}` : "Not saved yet"}
      positioning={{ placement: "top" }}
      showArrow
    >
      <HStack
        role="button"
        tabIndex={0}
        aria-label={`Rename ${name}`}
        cursor="pointer"
        minWidth={0}
        onClick={(e) => {
          e.stopPropagation();
          startEdit();
        }}
        onKeyDown={(e) => {
          // A focusable div is not a real button, so Enter/Space do not fire
          // click on their own — activate them by hand to keep the rename
          // reachable without a pointer (WCAG 2.1.1).
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            startEdit();
          }
        }}
        _hover={{ "& .edit-icon": { opacity: 1 } }}
        _focusVisible={{ "& .edit-icon": { opacity: 1 } }}
      >
        <Text
          fontSize={fontSize}
          fontWeight={fontWeight}
          {...(shouldTruncate ? { truncate: true, minWidth: 0 } : {})}
        >
          {displayText ?? name}
        </Text>
        <Box
          className="edit-icon"
          opacity={0}
          transition="opacity 0.2s"
          color="fg.subtle"
          flexShrink={0}
        >
          <Edit2 size={14} />
        </Box>
      </HStack>
    </Tooltip>
  );
}

export interface EditableWidgetNameProps {
  /** The full underlying name — what editing reads from and writes to. */
  name: string;
  /** What to show while not editing. Defaults to `name` (e.g. the drawer,
   *  which never strips anything) — a card passes its own stripped text. */
  displayText?: string;
  /** Omitted for a widget that doesn't exist yet (the create-chart drawer,
   *  before the first Save) — the tooltip has nothing to show then. */
  id?: string;
  onRename: (name: string) => void;
  fontSize?: string;
  fontWeight?: string;
  /** Card titles truncate to one line; the drawer's own heading doesn't need to. */
  shouldTruncate?: boolean;
}

export function EditableWidgetName({
  name,
  displayText,
  id,
  onRename,
  fontSize = "md",
  fontWeight = "500",
  shouldTruncate = false,
}: EditableWidgetNameProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => {
    setDraft(name);
    setIsEditing(true);
  };

  const finishEdit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <EditableWidgetNameInput
        draft={draft}
        setDraft={setDraft}
        finishEdit={finishEdit}
        cancelEdit={() => setIsEditing(false)}
        fontSize={fontSize}
        fontWeight={fontWeight}
      />
    );
  }

  return (
    <EditableWidgetNameDisplay
      name={name}
      {...(displayText === undefined ? {} : { displayText })}
      {...(id === undefined ? {} : { id })}
      startEdit={startEdit}
      fontSize={fontSize}
      fontWeight={fontWeight}
      shouldTruncate={shouldTruncate}
    />
  );
}
