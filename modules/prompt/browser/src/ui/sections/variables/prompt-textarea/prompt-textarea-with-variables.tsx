import { Box, HStack } from "@langwatch/design-system/primitives";
import { extractLiquidVariables } from "@langwatch/prompt-contract";
import {
  type ChangeEvent,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { type CaretPosition, RichTextarea, type RichTextareaHandle } from "rich-textarea";

import { useLayoutMode } from "../../../../model/layout-mode.ts";
import { VariableInsertMenu } from "../variable-insert-menu.tsx";
import type { AvailableSource } from "../variable-mapping-input.tsx";
import type { Variable } from "../variables-section.tsx";
import { AddLogicButton } from "./components/add-logic-button.tsx";
import { AddVariableButton } from "./components/add-variable-button.tsx";
import { renderLiquidText } from "./components/liquid-highlight.tsx";
import { GripHandles, LineHighlights } from "./components/paragraph-overlay.tsx";
import { TemplateLogicMenu } from "./components/template-logic-menu.tsx";
import { UndefinedVariablesBanner } from "./components/undefined-variables-banner.tsx";
import { useBannerReservation } from "./hooks/use-banner-reservation.ts";
import { useDebouncedTextarea } from "./hooks/use-debounced-textarea.ts";
import { useParagraphDragDrop } from "./hooks/use-paragraph-drag-drop.ts";
import { useTemplateLogicMenu } from "./hooks/use-template-logic-menu.ts";
import { useTextareaResize } from "./hooks/use-textarea-resize.ts";
import { useVariableMenu } from "./hooks/use-variable-menu.ts";
import type { PromptTextAreaWithVariablesProps } from "./prompt-textarea.types.ts";
import {
  findJustCompletedVariable,
  findUnclosedBraces,
  findUnclosedPercentBraces,
} from "./prompt-textarea.utils.ts";

type VariableMenu = ReturnType<typeof useVariableMenu>;
type LogicMenu = ReturnType<typeof useTemplateLogicMenu>;

/** What keyboard steering needs from whichever menu is open. */
type SteerableMenu = Pick<
  VariableMenu | LogicMenu,
  | "setIsKeyboardNav"
  | "setHighlightedIndex"
  | "optionCount"
  | "selectHighlightedOption"
  | "closeMenu"
>;

/** What a typed trigger needs from the menu it opens. */
type TriggeredMenu = Pick<VariableMenu | LogicMenu, "menuOpen" | "openMenu" | "setMenuQuery">;

/** Existing variables as a "Variables" source, when there are any. */
function variablesSource(variables: Variable[]): AvailableSource[] {
  if (variables.length === 0) return [];
  return [
    {
      id: "__variables__",
      name: "Variables",
      type: "signature",
      fields: variables.map((v) => ({ name: v.identifier, type: v.type })),
    },
  ];
}

/** External sources, narrowed to the fields `otherNodesFields` lists for them. */
function narrowedExternalSources({
  externalSources,
  otherNodesFields,
}: {
  externalSources: AvailableSource[];
  otherNodesFields: Record<string, string[]>;
}): AvailableSource[] {
  return externalSources.flatMap((source) => {
    const availableFields = otherNodesFields[source.id];
    if (availableFields === undefined) return [source];
    const fields = source.fields.filter((f) => availableFields.includes(f.name));
    return fields.length > 0 ? [{ ...source, fields }] : [];
  });
}

/** Nodes from `otherNodesFields` that no external source already added. */
function orphanNodeSources({
  otherNodesFields,
  addedNodeIds,
}: {
  otherNodesFields: Record<string, string[]>;
  addedNodeIds: Set<string>;
}): AvailableSource[] {
  return Object.entries(otherNodesFields)
    .filter(([nodeId, fields]) => !addedNodeIds.has(nodeId) && fields.length > 0)
    .map(([nodeId, fields]) => ({
      id: nodeId,
      name: nodeId,
      type: "signature",
      fields: fields.map((f) => ({ name: f, type: "str" })),
    }));
}

/** Merge variables, otherNodesFields into availableSources */
function mergeAvailableSources({
  variables,
  externalSources,
  otherNodesFields,
}: {
  variables: Variable[];
  externalSources: AvailableSource[];
  otherNodesFields: Record<string, string[]>;
}): AvailableSource[] {
  const external = narrowedExternalSources({ externalSources, otherNodesFields });
  const addedNodeIds = new Set(external.map((source) => source.id));
  return [
    ...variablesSource(variables),
    ...external,
    ...orphanNodeSources({ otherNodesFields, addedNodeIds }),
  ];
}

/**
 * Updates the shared caret refs. A typed-trigger menu follows the cursor: once
 * the caret leaves both the in-progress `{{…` and a just-completed `{{name}}`,
 * it closes. The button-opened menu manages its own lifecycle.
 */
function followSelection({
  pos,
  containerRef,
  caretPositionRef,
  lastUserCursorPosRef,
  variableMenu,
  localValue,
}: {
  pos: CaretPosition;
  containerRef: RefObject<HTMLDivElement | null>;
  caretPositionRef: RefObject<CaretPosition | null>;
  lastUserCursorPosRef: RefObject<number>;
  variableMenu: VariableMenu;
  localValue: string;
}) {
  caretPositionRef.current = pos;
  if (!pos.focused) return;
  const nativeTextarea = containerRef.current?.querySelector("textarea");
  if (nativeTextarea?.selectionStart === undefined) return;
  const cursor = nativeTextarea.selectionStart;
  lastUserCursorPosRef.current = cursor;
  if (!variableMenu.menuOpen || variableMenu.buttonMenuMode) return;
  const stillTyping = findUnclosedBraces(localValue, cursor);
  const stillOnCompleted = findJustCompletedVariable(localValue, cursor);
  if (!stillTyping && !stillOnCompleted) variableMenu.closeMenu();
}

function steerMenu({
  event,
  menu,
}: {
  event: KeyboardEvent<HTMLTextAreaElement>;
  menu: SteerableMenu;
}) {
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      menu.setIsKeyboardNav(true);
      menu.setHighlightedIndex((prev: number) => Math.min(prev + 1, menu.optionCount - 1));
      break;
    case "ArrowUp":
      event.preventDefault();
      menu.setIsKeyboardNav(true);
      menu.setHighlightedIndex((prev: number) => Math.max(prev - 1, 0));
      break;
    case "Enter":
    case "Tab":
      event.preventDefault();
      menu.selectHighlightedOption();
      break;
    case "Escape":
      event.preventDefault();
      menu.closeMenu();
      break;
  }
}

/** The open menu takes the key; the variable menu wins when both are open. */
function dispatchMenuKey({
  event,
  variableMenu,
  logicMenu,
}: {
  event: KeyboardEvent<HTMLTextAreaElement>;
  variableMenu: VariableMenu;
  logicMenu: LogicMenu;
}) {
  if (variableMenu.menuOpen) steerMenu({ event, menu: variableMenu });
  else if (logicMenu.menuOpen) steerMenu({ event, menu: logicMenu });
}

function openOrRequery({
  menu,
  start,
  query,
}: {
  menu: TriggeredMenu;
  start: number;
  query: string;
}) {
  if (menu.menuOpen) {
    menu.setMenuQuery(query);
    return;
  }
  setTimeout(() => menu.openMenu(start, query), 0);
}

/**
 * `{%` is checked first (more specific than `{{`) and the menus are mutually
 * exclusive. A just-completed `{{name}}` that resolves to nothing keeps the
 * variable menu open, so "Create variable" stays one click away.
 */
function followTriggers({
  text,
  cursor,
  variableMenu,
  logicMenu,
  offersCreate,
}: {
  text: string;
  cursor: number;
  variableMenu: VariableMenu;
  logicMenu: LogicMenu;
  offersCreate: (name: string) => boolean;
}) {
  const unclosedPercent = findUnclosedPercentBraces(text, cursor);
  if (unclosedPercent) {
    if (variableMenu.menuOpen) variableMenu.closeMenu();
    openOrRequery({ menu: logicMenu, ...unclosedPercent });
    return;
  }
  if (logicMenu.menuOpen) logicMenu.closeMenu();

  const unclosedBraces = findUnclosedBraces(text, cursor);
  if (unclosedBraces) {
    openOrRequery({ menu: variableMenu, ...unclosedBraces });
    return;
  }

  const completed = findJustCompletedVariable(text, cursor);
  if (completed && offersCreate(completed.name)) {
    openOrRequery({ menu: variableMenu, start: completed.start, query: completed.name });
  } else if (variableMenu.menuOpen) {
    variableMenu.closeMenu();
  }
}

function textareaStyle({
  borderless,
  fillHeight,
  hasError,
  minHeight,
  maxHeight,
  height,
  reservedBottomPadding,
}: {
  borderless: boolean;
  fillHeight: boolean;
  hasError: boolean;
  minHeight: string;
  maxHeight: string | undefined;
  height: string | undefined;
  reservedBottomPadding: number | null;
}): CSSProperties {
  const borderColor = hasError ? "var(--chakra-colors-red-500)" : "var(--chakra-colors-border)";
  return {
    width: "100%",
    minHeight: fillHeight ? "100%" : minHeight,
    maxHeight: fillHeight ? undefined : maxHeight,
    height,
    fontFamily: borderless
      ? undefined
      : 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: borderless ? "14px" : "13px",
    lineHeight: borderless ? "28px" : "1.5",
    padding: borderless ? "0 0 0 24px" : "8px 10px",
    ...(reservedBottomPadding !== null ? { paddingBottom: `${reservedBottomPadding}px` } : {}),
    border: borderless ? "none" : `1px solid ${borderColor}`,
    borderRadius: borderless ? "0" : "12px",
    outline: "none",
    resize: borderless ? "none" : "vertical",
    background: borderless ? "transparent" : undefined,
  };
}

/**
 * The bordered frame thickens on focus. The padding shorthand wipes the
 * banner reservation, so it is re-applied or focusing hides the last line.
 */
function paintFrame({
  element,
  focused,
  hasError,
  reservedBottomPadding,
}: {
  element: HTMLTextAreaElement;
  focused: boolean;
  hasError: boolean;
  reservedBottomPadding: number | null;
}) {
  const idleColor = focused ? "var(--chakra-colors-blue-500)" : "var(--chakra-colors-border)";
  element.style.borderColor = hasError ? "var(--chakra-colors-red-500)" : idleColor;
  element.style.borderWidth = focused ? "2px" : "1px";
  element.style.padding = focused ? "7px 9px" : "8px 10px";
  if (reservedBottomPadding !== null) {
    element.style.paddingBottom = `${reservedBottomPadding}px`;
  }
}

function addContextBottomOf({
  reservedBottomPadding,
  borderless,
}: {
  reservedBottomPadding: number | null;
  borderless: boolean;
}): string {
  if (reservedBottomPadding === null) return borderless ? "2px" : "10px";
  return `${reservedBottomPadding + (borderless ? 0 : 8)}px`;
}

/** Existing variable ids and the locally defined ones (loop iterators, assign). */
function useVariableUsage({
  variables,
  localValue,
}: {
  variables: Variable[];
  localValue: string;
}) {
  const existingVariableIds = useMemo(
    () => new Set(variables.map((v) => v.identifier)),
    [variables],
  );
  // Variables used in text - Liquid-aware extraction
  const liquidVariables = useMemo(() => extractLiquidVariables(localValue), [localValue]);
  const locallyDefinedVariables = useMemo(
    () => new Set([...liquidVariables.loopVariables, ...liquidVariables.assignedVariables]),
    [liquidVariables],
  );
  const usedVariables = liquidVariables.inputVariables;
  const invalidVariables = useMemo(
    () => usedVariables.filter((v) => !existingVariableIds.has(v)),
    [usedVariables, existingVariableIds],
  );
  const isKnownVariable = useCallback(
    (name: string) => existingVariableIds.has(name) || locallyDefinedVariables.has(name),
    [existingVariableIds, locallyDefinedVariables],
  );
  return { existingVariableIds, invalidVariables, isKnownVariable };
}

export const PromptTextAreaWithVariables = ({
  value,
  onChange,
  placeholder = "Enter your prompt...",
  availableSources: externalSources = [],
  variables = [],
  onCreateVariable,
  onSetVariableMapping,
  disabled = false,
  showAddContextButton = true,
  minHeight = "120px",
  maxHeight: maxHeightProp = "300px",
  hasError = false,
  onAddEdge,
  otherNodesFields = {},
  borderless = false,
  fillHeight = false,
  role,
  renderSourceIcon,
  ...boxProps
}: PromptTextAreaWithVariablesProps) => {
  // In horizontal layout mode, allow unlimited height
  const layoutMode = useLayoutMode();
  const maxHeight = layoutMode === "horizontal" ? undefined : maxHeightProp;

  const availableSources = useMemo(
    () => mergeAvailableSources({ variables, externalSources, otherNodesFields }),
    [externalSources, otherNodesFields, variables],
  );

  const textareaRef = useRef<RichTextareaHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Shared caret refs for both menus
  const caretPositionRef = useRef<CaretPosition | null>(null);
  const lastUserCursorPosRef = useRef(-1);

  const [isHovered, setIsHovered] = useState(false);

  const { localValue, handleValueChange, setValueImmediate } = useDebouncedTextarea({
    value,
    onChange,
  });

  const { existingVariableIds, invalidVariables, isKnownVariable } = useVariableUsage({
    variables,
    localValue,
  });

  const variableMenu = useVariableMenu({
    localValue,
    setValueImmediate,
    containerRef,
    existingVariableIds,
    availableSources,
    onCreateVariable,
    onSetVariableMapping,
    otherNodesFields,
    onAddEdge,
    caretPositionRef,
    lastUserCursorPosRef,
  });

  const logicMenu = useTemplateLogicMenu({
    localValue,
    setValueImmediate,
    containerRef,
    caretPositionRef,
    lastUserCursorPosRef,
  });

  const handleSelectionChange = useCallback(
    (pos: CaretPosition) =>
      followSelection({
        pos,
        containerRef,
        caretPositionRef,
        lastUserCursorPosRef,
        variableMenu,
        localValue,
      }),
    [containerRef, caretPositionRef, lastUserCursorPosRef, variableMenu, localValue],
  );

  const { userResizedHeight, useAutoHeight } = useTextareaResize({
    containerRef,
    minHeightPx: parseInt(minHeight, 10),
  });

  const paragraphs = useParagraphDragDrop({ localValue, onChange, containerRef, borderless });

  const { bannerRef, reservedBottomPadding } = useBannerReservation(invalidVariables);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) =>
      dispatchMenuKey({ event, variableMenu, logicMenu }),
    [variableMenu, logicMenu],
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      const cursor = e.target.selectionStart;
      handleValueChange(text);
      followTriggers({
        text,
        cursor,
        variableMenu,
        logicMenu,
        offersCreate: (name) => Boolean(onCreateVariable) && !isKnownVariable(name),
      });
    },
    [handleValueChange, variableMenu, logicMenu, onCreateVariable, isKnownVariable],
  );

  const renderText = useCallback(
    (text: string) => renderLiquidText({ text, isKnownVariable, borderless }),
    [isKnownVariable, borderless],
  );

  const paintOnFocusChange = (focused: boolean) => (e: FocusEvent<HTMLTextAreaElement>) => {
    if (borderless) return;
    paintFrame({ element: e.currentTarget, focused, hasError, reservedBottomPadding });
  };

  const visibleParagraphPositions = paragraphs.getVisibleParagraphPositions(isHovered);
  const showParagraphHandles = borderless && visibleParagraphPositions.length > 1;
  const resizedHeight = userResizedHeight ? `${userResizedHeight}px` : undefined;

  return (
    <>
      <Box
        ref={containerRef}
        position="relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          paragraphs.handleMouseLeave();
        }}
        onMouseMove={(e) => {
          setIsHovered(true);
          paragraphs.handleMouseMove(e);
        }}
        onDragOver={paragraphs.handleDragOverContainer}
        onDrop={(event) => {
          if (paragraphs.dropTargetParagraph === null) return;
          paragraphs.handleParagraphDrop(event, paragraphs.dropTargetParagraph);
        }}
        minHeight={fillHeight ? undefined : "120px"}
        height={fillHeight ? "100%" : undefined}
        {...boxProps}
      >
        {/* Line highlights - rendered BEFORE textarea so they appear behind text */}
        {showParagraphHandles && (
          <LineHighlights
            positions={visibleParagraphPositions}
            gripHoveredParagraph={paragraphs.gripHoveredParagraph}
            draggedParagraph={paragraphs.draggedParagraph}
          />
        )}

        <RichTextarea
          ref={textareaRef}
          value={localValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onSelectionChange={handleSelectionChange}
          placeholder={placeholder}
          disabled={disabled}
          autoHeight={useAutoHeight}
          data-role={role}
          className="rich-textarea-position-relative"
          style={textareaStyle({
            borderless,
            fillHeight,
            hasError,
            minHeight,
            maxHeight,
            height: fillHeight ? "100%" : resizedHeight,
            reservedBottomPadding,
          })}
          onFocus={paintOnFocusChange(true)}
          onBlur={paintOnFocusChange(false)}
        >
          {renderText}
        </RichTextarea>

        {/* Grip handles - rendered AFTER textarea so they're clickable on top */}
        {showParagraphHandles && (
          <GripHandles
            positions={visibleParagraphPositions}
            hoveredParagraph={paragraphs.hoveredParagraph}
            draggedParagraph={paragraphs.draggedParagraph}
            dropTargetParagraph={paragraphs.dropTargetParagraph}
            onGripHover={paragraphs.setGripHoveredParagraph}
            onDragStart={paragraphs.handleParagraphDragStart}
            onDragEnd={paragraphs.handleParagraphDragEnd}
          />
        )}

        <Box position="sticky" bottom={0} width="full">
          <UndefinedVariablesBanner
            bannerRef={bannerRef}
            invalidVariables={invalidVariables}
            borderless={borderless}
            onCreateVariable={onCreateVariable}
          />

          {/* Add variable and Add logic buttons */}
          {showAddContextButton && isHovered && !disabled && (
            <HStack
              position="absolute"
              bottom={addContextBottomOf({ reservedBottomPadding, borderless })}
              right={2}
              gap={1.5}
              data-testid="add-context-buttons"
            >
              {/* Two separate buttons, each with its own solid background so
                  message text behind never bleeds through the labels. */}
              <AddLogicButton
                ref={logicMenu.addButtonRef}
                onClick={logicMenu.handleAddLogicClick}
              />
              <AddVariableButton
                ref={variableMenu.addButtonRef}
                onClick={variableMenu.handleAddVariableClick}
              />
            </HStack>
          )}
        </Box>

        <VariableInsertMenu
          isOpen={variableMenu.menuOpen}
          position={variableMenu.menuPosition}
          availableSources={availableSources}
          query={variableMenu.menuQuery}
          onQueryChange={variableMenu.buttonMenuMode ? variableMenu.setMenuQuery : undefined}
          highlightedIndex={variableMenu.highlightedIndex}
          onHighlightChange={variableMenu.setHighlightedIndex}
          isKeyboardNav={variableMenu.isKeyboardNav}
          onKeyboardNavChange={variableMenu.setIsKeyboardNav}
          onSelect={variableMenu.handleSelectField}
          onCreateVariable={onCreateVariable ? variableMenu.handleCreateVariable : undefined}
          onClose={variableMenu.closeMenu}
          triggerRef={variableMenu.addButtonRef}
          renderSourceIcon={renderSourceIcon}
        />

        <TemplateLogicMenu
          isOpen={logicMenu.menuOpen}
          position={logicMenu.menuPosition}
          query={logicMenu.menuQuery}
          onQueryChange={logicMenu.buttonMenuMode ? logicMenu.setMenuQuery : undefined}
          filteredConstructs={logicMenu.filteredConstructs}
          highlightedIndex={logicMenu.highlightedIndex}
          onHighlightChange={logicMenu.setHighlightedIndex}
          isKeyboardNav={logicMenu.isKeyboardNav}
          onKeyboardNavChange={logicMenu.setIsKeyboardNav}
          onSelect={logicMenu.insertConstruct}
          onClose={logicMenu.closeMenu}
          triggerRef={logicMenu.addButtonRef}
        />
      </Box>
    </>
  );
};
