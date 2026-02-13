import { Box, HStack, Text } from "@chakra-ui/react";
import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { RichTextarea, type RichTextareaHandle } from "rich-textarea";
import type { CaretPosition } from "rich-textarea";
import { useLayoutMode } from "~/prompts/prompt-playground/components/prompt-browser/prompt-browser-window/PromptBrowserWindowContent";
import { VariableInsertMenu } from "../variables/VariableInsertMenu";
import type { AvailableSource } from "../variables/VariableMappingInput";
import { AddLogicButton } from "./components/AddLogicButton";
import { AddVariableButton } from "./components/AddVariableButton";
import { TemplateLogicMenu } from "./components/TemplateLogicMenu";
import { GripHandles, LineHighlights } from "./components/ParagraphOverlay";
import { useDebouncedTextarea } from "./hooks/useDebouncedTextarea";
import { useParagraphDragDrop } from "./hooks/useParagraphDragDrop";
import { useTemplateLogicMenu } from "./hooks/useTemplateLogicMenu";
import { useTextareaResize } from "./hooks/useTextareaResize";
import { useVariableMenu } from "./hooks/useVariableMenu";
import type { PromptTextAreaWithVariablesProps } from "./types";
import {
  extractLiquidVariables,
  tokenizeLiquidTemplate,
} from "./liquidTokenizer";
import { findUnclosedBraces, findUnclosedPercentBraces } from "./utils";

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
  ...boxProps
}: PromptTextAreaWithVariablesProps) => {
  // In horizontal layout mode, allow unlimited height
  const layoutMode = useLayoutMode();
  const maxHeight = layoutMode === "horizontal" ? undefined : maxHeightProp;

  // Merge variables, otherNodesFields into availableSources
  const availableSources = useMemo(() => {
    const sources: AvailableSource[] = [];

    // Add existing variables as a "Variables" source
    if (variables.length > 0) {
      sources.push({
        id: "__variables__",
        name: "Variables",
        type: "signature",
        fields: variables.map((v) => ({ name: v.identifier, type: v.type })),
      });
    }

    const addedNodeIds = new Set<string>();

    for (const source of externalSources) {
      const availableFields = otherNodesFields[source.id];
      if (availableFields !== undefined) {
        const filteredFields = source.fields.filter((f) =>
          availableFields.includes(f.name),
        );
        if (filteredFields.length > 0) {
          sources.push({ ...source, fields: filteredFields });
          addedNodeIds.add(source.id);
        }
      } else {
        sources.push(source);
        addedNodeIds.add(source.id);
      }
    }

    // Add any nodes from otherNodesFields not in externalSources
    for (const [nodeId, fields] of Object.entries(otherNodesFields)) {
      if (!addedNodeIds.has(nodeId) && fields.length > 0) {
        sources.push({
          id: nodeId,
          name: nodeId,
          type: "signature",
          fields: fields.map((f) => ({ name: f, type: "str" })),
        });
      }
    }

    return sources;
  }, [externalSources, otherNodesFields, variables]);

  const textareaRef = useRef<RichTextareaHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Shared caret refs for both menus
  const caretPositionRef = useRef<CaretPosition | null>(null);
  const lastUserCursorPosRef = useRef(-1);

  // Hover state
  const [isHovered, setIsHovered] = useState(false);

  // Debounced textarea value management
  const { localValue, handleValueChange, setValueImmediate } =
    useDebouncedTextarea({ value, onChange });

  // Existing variable identifiers
  const existingVariableIds = useMemo(
    () => new Set(variables.map((v) => v.identifier)),
    [variables],
  );

  // Variable menu logic
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

  // Template logic menu
  const logicMenu = useTemplateLogicMenu({
    localValue,
    setValueImmediate,
    containerRef,
    caretPositionRef,
    lastUserCursorPosRef,
  });

  // Shared selection change handler that updates caret refs for both menus
  const handleSelectionChange = useCallback(
    (pos: CaretPosition) => {
      caretPositionRef.current = pos;
      if (pos.focused) {
        const nativeTextarea = containerRef.current?.querySelector("textarea");
        if (nativeTextarea?.selectionStart !== undefined) {
          lastUserCursorPosRef.current = nativeTextarea.selectionStart;
        }
      }
    },
    [containerRef, caretPositionRef, lastUserCursorPosRef],
  );

  // Textarea resize detection
  const minHeightPx = parseInt(minHeight ?? "120", 10);
  const { userResizedHeight, useAutoHeight } = useTextareaResize({
    containerRef,
    minHeightPx,
  });

  // Paragraph drag-drop
  const {
    hoveredParagraph,
    gripHoveredParagraph,
    draggedParagraph,
    dropTargetParagraph,
    setGripHoveredParagraph,
    handleParagraphDragStart,
    handleParagraphDrop,
    handleParagraphDragEnd,
    handleMouseMove,
    handleDragOverContainer,
    handleMouseLeave,
    getVisibleParagraphPositions,
  } = useParagraphDragDrop({
    localValue,
    onChange,
    containerRef,
    borderless,
  });

  // Variables used in text - Liquid-aware extraction
  const liquidVariables = useMemo(
    () => extractLiquidVariables(localValue),
    [localValue],
  );

  const usedVariables = liquidVariables.inputVariables;

  // Variables that are defined locally (loop iterators, assign) - not "undefined"
  const locallyDefinedVariables = useMemo(
    () =>
      new Set([
        ...liquidVariables.loopVariables,
        ...liquidVariables.assignedVariables,
      ]),
    [liquidVariables],
  );

  const invalidVariables = useMemo(
    () => usedVariables.filter((v) => !existingVariableIds.has(v)),
    [usedVariables, existingVariableIds],
  );

  // Handle keyboard input - dispatches to whichever menu is active
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Determine which menu is active
      const activeMenu = variableMenu.menuOpen
        ? variableMenu
        : logicMenu.menuOpen
          ? logicMenu
          : null;

      if (!activeMenu) {
        if (e.key === "Escape") return;
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          activeMenu.setIsKeyboardNav(true);
          activeMenu.setHighlightedIndex((prev: number) =>
            Math.min(prev + 1, activeMenu.optionCount - 1),
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          activeMenu.setIsKeyboardNav(true);
          activeMenu.setHighlightedIndex((prev: number) =>
            Math.max(prev - 1, 0),
          );
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          activeMenu.selectHighlightedOption();
          break;
        case "Escape":
          e.preventDefault();
          activeMenu.closeMenu();
          break;
      }
    },
    [variableMenu, logicMenu],
  );

  // Handle text change - checks for both {%  and {{ triggers with mutual exclusion
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursorPos = e.target.selectionStart;

      handleValueChange(newValue);

      // Check {%  first since it's more specific than {{
      const unclosedPercent = findUnclosedPercentBraces(newValue, cursorPos);

      if (unclosedPercent) {
        // Close variable menu if open (mutual exclusion)
        if (variableMenu.menuOpen) {
          variableMenu.closeMenu();
        }

        if (!logicMenu.menuOpen) {
          setTimeout(
            () =>
              logicMenu.openMenu(unclosedPercent.start, unclosedPercent.query),
            0,
          );
        } else {
          logicMenu.setMenuQuery(unclosedPercent.query);
        }
        return;
      }

      // If no {% trigger, close logic menu if open
      if (logicMenu.menuOpen) {
        logicMenu.closeMenu();
      }

      // Check for unclosed {{ before cursor
      const unclosedBraces = findUnclosedBraces(newValue, cursorPos);

      if (unclosedBraces) {
        if (!variableMenu.menuOpen) {
          setTimeout(
            () =>
              variableMenu.openMenu(
                unclosedBraces.start,
                unclosedBraces.query,
              ),
            0,
          );
        } else {
          variableMenu.setMenuQuery(unclosedBraces.query);
        }
      } else if (variableMenu.menuOpen) {
        variableMenu.closeMenu();
      }
    },
    [handleValueChange, variableMenu, logicMenu],
  );

  // Render function for rich-textarea - highlights Liquid tags and variables
  const renderText = useCallback(
    (text: string) => {
      if (!text) return null;

      const tokens = tokenizeLiquidTemplate(text);
      if (tokens.length === 0) return null;

      return tokens.map((token, index) => {
        if (token.type === "plain-text") {
          return token.value;
        }

        if (token.type === "variable") {
          // Extract the variable name (before any filter pipe)
          const inner = token.value.slice(2, -2).trim();
          const varName = inner.split("|")[0]!.trim().split(".")[0]!.trim();
          // Valid if it's an existing external variable OR a locally-defined one (loop/assign)
          const isInvalid = varName
            ? !existingVariableIds.has(varName) &&
              !locallyDefinedVariables.has(varName)
            : true;

          const variableColor = isInvalid
            ? "var(--chakra-colors-red-500)"
            : "var(--chakra-colors-blue-500)";

          return (
            <span
              key={`var-${index}`}
              style={{
                color: variableColor,
                // In borderless mode with variable-width fonts (Inter), real fontWeight
                // changes character width and breaks caret positioning. Use text-shadow
                // for a "faux bold" effect that doesn't affect text metrics.
                fontWeight: borderless ? undefined : 600,
                textShadow: borderless
                  ? `0px 0px 1px ${variableColor}`
                  : undefined,
              }}
            >
              {token.value}
            </span>
          );
        }

        // liquid-tag: highlight with a distinct color
        const tagColor = "var(--chakra-colors-purple-500)";
        return (
          <span
            key={`tag-${index}`}
            style={{
              color: tagColor,
              fontWeight: borderless ? undefined : 600,
              textShadow: borderless
                ? `0px 0px 1px ${tagColor}`
                : undefined,
            }}
          >
            {token.value}
          </span>
        );
      });
    },
    [existingVariableIds, locallyDefinedVariables, borderless],
  );

  const visibleParagraphPositions = getVisibleParagraphPositions(isHovered);

  return (
    <>
      <Box
        ref={containerRef}
        position="relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          handleMouseLeave();
        }}
        onMouseMove={(e) => {
          setIsHovered(true);
          handleMouseMove(e);
        }}
        onDragOver={handleDragOverContainer}
        onDrop={(e) => {
          if (dropTargetParagraph !== null) {
            handleParagraphDrop(e as unknown as DragEvent, dropTargetParagraph);
          }
        }}
        minHeight={fillHeight ? undefined : "120px"}
        height={fillHeight ? "100%" : undefined}
        {...boxProps}
      >
        {/* Line highlights - rendered BEFORE textarea so they appear behind text */}
        {borderless && visibleParagraphPositions.length > 1 && (
          <LineHighlights
            positions={visibleParagraphPositions}
            gripHoveredParagraph={gripHoveredParagraph}
            draggedParagraph={draggedParagraph}
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
          style={{
            width: "100%",
            minHeight: fillHeight ? "100%" : minHeight,
            maxHeight: fillHeight ? undefined : maxHeight,
            height: fillHeight
              ? "100%"
              : userResizedHeight
                ? `${userResizedHeight}px`
                : undefined,
            fontFamily: borderless
              ? undefined
              : 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            fontSize: borderless ? "14px" : "13px",
            lineHeight: borderless ? "28px" : "1.5",
            padding: borderless ? "0 0 0 24px" : "8px 10px",
            ...(invalidVariables.length > 0 ? { paddingBottom: "28px" } : {}),
            border: borderless
              ? "none"
              : `1px solid ${
                  hasError
                    ? "var(--chakra-colors-red-500)"
                    : "var(--chakra-colors-border)"
                }`,
            borderRadius: borderless ? "0" : "12px",
            outline: "none",
            resize: borderless ? "none" : "vertical",
            background: borderless ? "transparent" : undefined,
          }}
          onFocus={(e) => {
            if (borderless) return;
            e.currentTarget.style.borderColor = hasError
              ? "var(--chakra-colors-red-500)"
              : "var(--chakra-colors-blue-500)";
            e.currentTarget.style.borderWidth = "2px";
            e.currentTarget.style.padding = "7px 9px";
          }}
          onBlur={(e) => {
            if (borderless) return;
            e.currentTarget.style.borderColor = hasError
              ? "var(--chakra-colors-red-500)"
              : "var(--chakra-colors-border)";
            e.currentTarget.style.borderWidth = "1px";
            e.currentTarget.style.padding = "8px 10px";
          }}
        >
          {renderText}
        </RichTextarea>

        {/* Grip handles - rendered AFTER textarea so they're clickable on top */}
        {borderless && visibleParagraphPositions.length > 1 && (
          <GripHandles
            positions={visibleParagraphPositions}
            hoveredParagraph={hoveredParagraph}
            draggedParagraph={draggedParagraph}
            dropTargetParagraph={dropTargetParagraph}
            onGripHover={setGripHoveredParagraph}
            onDragStart={handleParagraphDragStart}
            onDragEnd={handleParagraphDragEnd}
          />
        )}

        <Box position="sticky" bottom={0} width="full">
          {/* Invalid variables warning */}
          {invalidVariables.length > 0 && (
            <Text
              fontSize="xs"
              color="red.fg"
              backgroundColor="red.subtle"
              borderRadius="lg"
              padding={1}
              marginBottom={1}
              paddingLeft={2}
              position="absolute"
              bottom={borderless ? -2 : 0}
              marginLeft={1}
              width="calc(100% - 8px)"
            >
              Undefined variables: {invalidVariables.join(", ")}
            </Text>
          )}

          {/* Add variable and Add logic buttons */}
          {showAddContextButton && isHovered && !disabled && (
            <HStack
              position="absolute"
              bottom={
                (invalidVariables.length > 0 ? 9 : 2.5) - (borderless ? 2 : 0)
              }
              right={2}
              gap={1}
            >
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

        {/* Variable Insert Menu */}
        <VariableInsertMenu
          isOpen={variableMenu.menuOpen}
          position={variableMenu.menuPosition}
          availableSources={availableSources}
          query={variableMenu.menuQuery}
          onQueryChange={
            variableMenu.buttonMenuMode
              ? variableMenu.setMenuQuery
              : undefined
          }
          highlightedIndex={variableMenu.highlightedIndex}
          onHighlightChange={variableMenu.setHighlightedIndex}
          isKeyboardNav={variableMenu.isKeyboardNav}
          onKeyboardNavChange={variableMenu.setIsKeyboardNav}
          onSelect={variableMenu.handleSelectField}
          onCreateVariable={
            onCreateVariable ? variableMenu.handleCreateVariable : undefined
          }
          onClose={variableMenu.closeMenu}
          triggerRef={variableMenu.addButtonRef}
        />

        {/* Template Logic Menu */}
        <TemplateLogicMenu
          isOpen={logicMenu.menuOpen}
          position={logicMenu.menuPosition}
          query={logicMenu.menuQuery}
          onQueryChange={
            logicMenu.buttonMenuMode ? logicMenu.setMenuQuery : undefined
          }
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
