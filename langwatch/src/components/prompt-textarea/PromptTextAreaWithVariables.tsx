import { Box, Text } from "@chakra-ui/react";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { RichTextarea, type RichTextareaHandle } from "rich-textarea";
import { useLayoutMode } from "~/prompts/prompt-playground/components/prompt-browser/prompt-browser-window/PromptBrowserWindowContent";
import { VariableInsertMenu } from "../variables/VariableInsertMenu";
import type { AvailableSource } from "../variables/VariableMappingInput";
import type { PromptTextAreaWithVariablesProps } from "./types";
import {
  VARIABLE_REGEX,
  parseVariablesFromText,
  findUnclosedBraces,
} from "./utils";
import { useDebouncedTextarea } from "./hooks/useDebouncedTextarea";
import { useVariableMenu } from "./hooks/useVariableMenu";
import { useTextareaResize } from "./hooks/useTextareaResize";
import { useParagraphDragDrop } from "./hooks/useParagraphDragDrop";
import { LineHighlights, GripHandles } from "./components/ParagraphOverlay";
import { AddVariableButton } from "./components/AddVariableButton";

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
  const {
    menuOpen,
    menuPosition,
    menuQuery,
    setMenuQuery,
    highlightedIndex,
    setHighlightedIndex,
    isKeyboardNav,
    setIsKeyboardNav,
    buttonMenuMode,
    optionCount,
    addButtonRef,
    handleSelectionChange,
    openMenu,
    closeMenu,
    selectHighlightedOption,
    handleSelectField,
    handleCreateVariable,
    handleAddVariableClick,
  } = useVariableMenu({
    localValue,
    setValueImmediate,
    containerRef,
    existingVariableIds,
    availableSources,
    onCreateVariable,
    onSetVariableMapping,
    otherNodesFields,
    onAddEdge,
  });

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

  // Variables used in text but not defined
  const usedVariables = useMemo(
    () => parseVariablesFromText(localValue),
    [localValue],
  );

  const invalidVariables = useMemo(
    () => usedVariables.filter((v) => !existingVariableIds.has(v)),
    [usedVariables, existingVariableIds],
  );

  // Handle keyboard input
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!menuOpen) {
        if (e.key === "Escape") return;
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setIsKeyboardNav(true);
          setHighlightedIndex((prev) => Math.min(prev + 1, optionCount - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setIsKeyboardNav(true);
          setHighlightedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          selectHighlightedOption();
          break;
        case "Escape":
          e.preventDefault();
          closeMenu();
          break;
      }
    },
    [
      menuOpen,
      optionCount,
      closeMenu,
      selectHighlightedOption,
      setHighlightedIndex,
      setIsKeyboardNav,
    ],
  );

  // Handle text change
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursorPos = e.target.selectionStart;

      handleValueChange(newValue);

      // Check for unclosed {{ before cursor
      const unclosed = findUnclosedBraces(newValue, cursorPos);

      if (unclosed) {
        if (!menuOpen) {
          setTimeout(() => openMenu(unclosed.start, unclosed.query), 0);
        } else {
          setMenuQuery(unclosed.query);
        }
      } else if (menuOpen) {
        closeMenu();
      }
    },
    [handleValueChange, menuOpen, openMenu, closeMenu, setMenuQuery],
  );

  // Render function for rich-textarea - highlights variables
  const renderText = useCallback(
    (text: string) => {
      if (!text) return null;

      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match;

      const regex = new RegExp(VARIABLE_REGEX);
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          parts.push(text.substring(lastIndex, match.index));
        }

        const varName = match[1] ?? "";
        const isInvalid = varName ? !existingVariableIds.has(varName) : true;

        const variableColor = isInvalid
          ? "var(--chakra-colors-red-500)"
          : "var(--chakra-colors-blue-500)";

        parts.push(
          <span
            key={`var-${match.index}`}
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
            {match[0]}
          </span>,
        );

        lastIndex = regex.lastIndex;
      }

      if (lastIndex < text.length) {
        parts.push(text.substring(lastIndex));
      }

      return parts;
    },
    [existingVariableIds, borderless],
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
                    : "var(--chakra-colors-gray-200)"
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
              : "var(--chakra-colors-gray-200)";
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
              color="red.800"
              backgroundColor="red.50"
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

          {/* Add variable button */}
          {showAddContextButton && isHovered && !disabled && (
            <AddVariableButton
              ref={addButtonRef}
              onClick={handleAddVariableClick}
              bottom={
                (invalidVariables.length > 0 ? 9 : 2.5) - (borderless ? 2 : 0)
              }
            />
          )}
        </Box>

        {/* Variable Insert Menu */}
        <VariableInsertMenu
          isOpen={menuOpen}
          position={menuPosition}
          availableSources={availableSources}
          query={menuQuery}
          onQueryChange={buttonMenuMode ? setMenuQuery : undefined}
          highlightedIndex={highlightedIndex}
          onHighlightChange={setHighlightedIndex}
          isKeyboardNav={isKeyboardNav}
          onKeyboardNavChange={setIsKeyboardNav}
          onSelect={handleSelectField}
          onCreateVariable={onCreateVariable ? handleCreateVariable : undefined}
          onClose={closeMenu}
          triggerRef={addButtonRef}
        />
      </Box>
    </>
  );
};
