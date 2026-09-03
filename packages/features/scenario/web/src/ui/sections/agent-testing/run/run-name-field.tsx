/**
 * The name of the run, and the configurations this scope already ran with.
 *
 * The field is a plain input until the scope has a history. Once it has one, a
 * caret opens the list, typing filters it, the arrow keys move through it and
 * Enter takes the highlighted entry.
 *
 * The keys are handled on the wrapping element rather than on the input,
 * because the caret takes focus when it opens the list and Escape has to close
 * the list from either.
 *
 * Escape needs both halves. Stopping the event keeps it off the dialog's own
 * React tree, and the dialog turns its own Escape handling off while the list
 * is open, because that one listens on the document in the capture phase and
 * therefore runs before anything inside the dialog can stop it.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, chakra, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatTimeAgoCompact } from "@langwatch/workflow-web/utils/formatTimeAgo";
import {
  DIALOG_FIELD_STYLE,
  FieldLabel,
} from "../../../elements/agent-testing/shared/dialog-fields";
import { FG_MUTED } from "../../../../model/agent-testing/shared/design";

/** One line of the dropdown. */
export type RunNameOption = {
  key: string;
  name: string;
  /** What tells this entry from the others that share its name. */
  detail: string;
  lastRunAt: Date | null;
};

/** How long ago this configuration last ran, or nothing when it never did. */
function lastRunLabel(lastRunAt: Date | null): string {
  if (!lastRunAt) return "";
  return formatTimeAgoCompact(lastRunAt.getTime());
}

/** What the list is doing: open or not, filtered or not, and which row is on. */
function useRunNameList({
  value,
  options,
  onPick,
}: {
  value: string;
  options: RunNameOption[];
  onPick: (key: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // Typing narrows the list; the caret shows all of it whatever is typed.
  const [isFiltering, setIsFiltering] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shown = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!isFiltering || query === "") return options;
    return options.filter((option) => option.name.toLowerCase().includes(query));
  }, [options, isFiltering, value]);

  // A name that matches nothing is the new plan path: a plain field, no list.
  const isListOpen = isOpen && shown.length > 0;

  /**
   * Drops a close the field is still waiting on. Every path that opens the
   * list calls this first: a blur arms a close for 140ms, so a person who
   * moves from the caret into the field and types would otherwise watch the
   * list they just opened close under them.
   */
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  // The armed close also outlives the field, so it is dropped on unmount.
  useEffect(() => cancelClose, []);

  const take = (option: RunNameOption) => {
    cancelClose();
    setIsOpen(false);
    setIsFiltering(false);
    onPick(option.key);
  };

  /** The list closes on blur, late enough for a click on a row to land. */
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setIsOpen(false), 140);
  };

  /** The caret shows the whole list whatever is typed in the field. */
  const toggleAll = () => {
    cancelClose();
    setIsFiltering(false);
    setActiveIndex(0);
    setIsOpen((open) => !open);
  };

  /** Typing narrows the list and opens it. */
  const filterBy = (typed: string) => {
    cancelClose();
    setIsFiltering(true);
    setActiveIndex(0);
    if (options.length > 0 && typed.trim() !== "") setIsOpen(true);
  };

  const moveBy = (step: number) => {
    if (!isListOpen && step > 0) {
      cancelClose();
      setIsFiltering(false);
      setActiveIndex(0);
      setIsOpen(true);
      return;
    }
    setActiveIndex((index) => Math.min(Math.max(index + step, 0), shown.length - 1));
  };

  const takeActive = () => {
    const option = shown[activeIndex];
    if (isListOpen && option) take(option);
  };

  return {
    isOpen,
    isListOpen,
    shown,
    activeIndex,
    setActiveIndex,
    take,
    closeSoon,
    toggleAll,
    filterBy,
    moveBy,
    takeActive,
    close: () => setIsOpen(false),
  };
}

type RunNameList = ReturnType<typeof useRunNameList>;

/** The rows of the dropdown: a name, how long ago it ran, and what it ran with. */
function RunNameOptions({ list }: { list: RunNameList }) {
  return (
    <VStack
      align="stretch"
      gap={0}
      position="absolute"
      top="100%"
      left={0}
      right={0}
      zIndex="dropdown"
      marginTop={1}
      maxHeight="240px"
      overflowY="auto"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      background="bg.panel"
      boxShadow="md"
      paddingY={1}
      data-testid="run-dialog-name-options"
    >
      {list.shown.map((option, index) => (
        <chakra.button
          key={option.key}
          type="button"
          textAlign="left"
          paddingX={3}
          paddingY={1.5}
          cursor="pointer"
          boxShadow="none"
          background={index === list.activeIndex ? "bg.muted" : "transparent"}
          aria-selected={index === list.activeIndex}
          onMouseEnter={() => list.setActiveIndex(index)}
          // The click has to land before the blur closes the list.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => list.take(option)}
          data-testid={`run-dialog-name-option-${option.key}`}
        >
          <HStack gap={2} alignItems="baseline">
            <Text fontSize="12.5px" fontWeight="medium" truncate>
              {option.name}
            </Text>
            <Text fontSize="11px" color={FG_MUTED} whiteSpace="nowrap">
              {lastRunLabel(option.lastRunAt)}
            </Text>
          </HStack>
          {option.detail && (
            <Text fontSize="11px" color={FG_MUTED} truncate>
              {option.detail}
            </Text>
          )}
        </chakra.button>
      ))}
    </VStack>
  );
}

/**
 * The keys of the field, handled on the wrapping element.
 *
 * Escape stops here: without that it reaches the dialog's own listener and
 * takes the whole dialog away instead of only the list.
 */
function listKeyHandler(list: RunNameList) {
  return (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      list.moveBy(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      list.moveBy(-1);
      return;
    }
    if (event.key === "Enter" && list.isListOpen) {
      event.preventDefault();
      list.takeActive();
      return;
    }
    if (event.key === "Escape" && list.isOpen) {
      event.preventDefault();
      event.stopPropagation();
      list.close();
    }
  };
}

export function RunNameField({
  value,
  options,
  onChange,
  onPick,
  onListOpenChange,
  isBusy,
}: {
  value: string;
  /** The configurations of this scope, newest first. */
  options: RunNameOption[];
  /** Typing a name of one's own, which stops the name following the run. */
  onChange: (value: string) => void;
  onPick: (key: string) => void;
  /**
   * Whether the list is open, which the dialog needs: Escape must close the
   * list alone, and the dialog's own Escape handling runs first.
   */
  onListOpenChange: (isOpen: boolean) => void;
  isBusy: boolean;
}) {
  const list = useRunNameList({ value, options, onPick });
  const hasHistory = options.length > 0;

  useEffect(() => {
    onListOpenChange(list.isListOpen);
  }, [list.isListOpen, onListOpenChange]);

  return (
    <Box data-testid="run-dialog-name-block">
      <FieldLabel>Run name</FieldLabel>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <Box position="relative" onKeyDown={listKeyHandler(list)}>
        <Input
          {...DIALOG_FIELD_STYLE}
          aria-label="Run name"
          autoComplete="off"
          disabled={isBusy}
          paddingRight={hasHistory ? 9 : undefined}
          placeholder="Refunds dev-agent"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            list.filterBy(event.target.value);
          }}
          onBlur={list.closeSoon}
          data-testid="run-dialog-name"
        />
        {hasHistory && (
          <chakra.button
            type="button"
            aria-label="Configurations this scope ran with before"
            position="absolute"
            top="50%"
            right="6px"
            transform="translateY(-50%)"
            display="flex"
            alignItems="center"
            justifyContent="center"
            boxSize="24px"
            borderRadius="md"
            color={FG_MUTED}
            cursor="pointer"
            boxShadow="none"
            _hover={{ background: "bg.muted", color: "fg" }}
            onClick={list.toggleAll}
            onBlur={list.closeSoon}
            data-testid="run-dialog-name-caret"
          >
            <ChevronDown size={14} />
          </chakra.button>
        )}
        {list.isListOpen && <RunNameOptions list={list} />}
      </Box>
    </Box>
  );
}
