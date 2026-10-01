import { Box, HStack, Input, Portal, Tag, Text, VStack } from "@langwatch/design-system/primitives";
import type {
  AvailableSource,
  FieldMapping,
  NestedField,
  SourceType,
} from "@langwatch/workflow-contract";
import { Check, ChevronRight, Type } from "lucide-react";
import {
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { VariableTypeBadge, VariableTypeIcon } from "./variable-type/index.ts";

// ============================================================================
// Types
// ============================================================================

export type {
  AvailableSource,
  FieldMapping,
  FieldType,
  NestedField,
  SourceType,
} from "@langwatch/workflow-contract";

export type RenderSourceIcon = (type: SourceType) => ReactNode;

type VariableMappingInputProps = {
  /** Draws a source's icon; the consumer owns the icon set. */
  renderSourceIcon?: RenderSourceIcon;
  /** Current mapping (source or value) */
  mapping?: FieldMapping;
  /** Callback when mapping changes */
  onMappingChange?: (mapping: FieldMapping | undefined) => void;
  /** Available sources to map from */
  availableSources: AvailableSource[];
  /** Placeholder text */
  placeholder?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Whether this mapping is missing and should be highlighted */
  isMissing?: boolean;
  /**
   * When true, shows the missing-highlight background but not the "Required" placeholder (for
   * optional fields).
   */
  optionalHighlighting?: boolean;
  /** Identifier used for data-testid on the underlying input element */
  inputTestId?: string;
};

/** Represents a selectable option in the dropdown */
type DropdownOption =
  | {
      type: "field";
      sourceId: string;
      sourceName: string;
      sourceType: SourceType;
      field: NestedField;
    }
  | { type: "value"; value: string };

/** The nested path being built up as the user drills into a source's fields. */
type InProgressPath = { sourceId: string; path: string[] };

type DropdownContext = {
  fields: NestedField[] | null;
  source: AvailableSource | null;
  parentFieldName: string | null;
  isParentComplete: boolean;
  parentIsCompleteLabel: string | null;
};

type DropdownPosition = { top: number; left: number; width: number; placement: "bottom" | "top" };

type MappingSetters = {
  setLocalMapping: (mapping: FieldMapping | undefined) => void;
  setInProgressPath: (path: InProgressPath | null) => void;
  setSearchQuery: (query: string) => void;
  setIsOpen: (open: boolean) => void;
  setHighlightedIndex: Dispatch<SetStateAction<number>>;
  setIsKeyboardNav: (value: boolean) => void;
  onMappingChange: ((mapping: FieldMapping | undefined) => void) | undefined;
  focusInput: () => void;
};

type MappingState = {
  localMapping: FieldMapping | undefined;
  inProgressPath: InProgressPath | null;
  searchQuery: string;
  isOpen: boolean;
  highlightedIndex: number;
  isKeyboardNav: boolean;
};

const DROPDOWN_MAX_HEIGHT = 300;
const DROPDOWN_GAP = 4;

const TOP_LEVEL_CONTEXT: DropdownContext = {
  fields: null,
  source: null,
  parentFieldName: null,
  isParentComplete: false,
  parentIsCompleteLabel: null,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a field has nested children (either static or dynamic)
 */
const hasChildren = (field: NestedField): boolean => {
  return !!(field.children?.length || field.getChildren);
};

/**
 * Get children for a field (handles both static and dynamic)
 */
const getFieldChildren = (field: NestedField): NestedField[] => {
  if (field.children) return field.children;
  if (field.getChildren) return field.getChildren();
  return [];
};

/**
 * Check if selecting a field is "complete" (doesn't require further selection)
 */
const isFieldComplete = (field: NestedField): boolean => {
  // Explicit override
  if (field.isComplete !== undefined) return field.isComplete;
  // Default: complete if no children
  return !hasChildren(field);
};

/** The fields the dropdown lists: a source's nested level, or null at the top. */
function dropdownContextOf({
  availableSources,
  inProgressPath,
}: {
  availableSources: AvailableSource[];
  inProgressPath: InProgressPath | null;
}): DropdownContext {
  if (!inProgressPath) return TOP_LEVEL_CONTEXT;
  const source = availableSources.find((s) => s.id === inProgressPath.sourceId);
  if (!source) return { ...TOP_LEVEL_CONTEXT, fields: [] };

  let currentFields = source.fields;
  let parentField: NestedField | undefined;
  for (const segment of inProgressPath.path) {
    const field = currentFields.find((f) => f.name === segment);
    if (!field) return { ...TOP_LEVEL_CONTEXT, fields: [], source };
    parentField = field;
    currentFields = getFieldChildren(field);
  }

  return {
    fields: currentFields,
    source,
    parentFieldName: inProgressPath.path[inProgressPath.path.length - 1] ?? null,
    isParentComplete: parentField ? isFieldComplete(parentField) : false,
    parentIsCompleteLabel: parentField?.isCompleteLabel ?? null,
  };
}

function labelMatches({ field, query }: { field: NestedField; query: string }): boolean {
  return (field.label ?? field.name ?? "").toLowerCase().includes(query.toLowerCase());
}

/** Filter sources/fields based on search query and current context */
function filterSources({
  availableSources,
  searchQuery,
  context,
}: {
  availableSources: AvailableSource[];
  searchQuery: string;
  context: DropdownContext;
}): AvailableSource[] {
  if (context.fields && context.source) {
    const fields = context.fields.filter((field) => labelMatches({ field, query: searchQuery }));
    return [{ ...context.source, fields }];
  }
  return availableSources
    .map((source) => ({
      ...source,
      fields: source.fields.filter((field) => labelMatches({ field, query: searchQuery })),
    }))
    .filter((source) => source.fields.length > 0);
}

/** Flat list of options for keyboard navigation; "use as value" only at the top level. */
function optionsOf({
  filteredSources,
  searchQuery,
  inProgressPath,
}: {
  filteredSources: AvailableSource[];
  searchQuery: string;
  inProgressPath: InProgressPath | null;
}): DropdownOption[] {
  const fieldOptions = filteredSources.flatMap((source) =>
    source.fields.map((field): DropdownOption => ({
      type: "field",
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.type,
      field,
    })),
  );
  const typed = searchQuery.trim();
  if (!typed || inProgressPath) return fieldOptions;
  return [...fieldOptions, { type: "value", value: typed }];
}

/** Below the input by default; flipped above when there is more room there. */
function dropdownPositionOf({
  rect,
  viewportHeight,
  measuredHeight,
}: {
  rect: DOMRect;
  viewportHeight: number;
  measuredHeight: number | undefined;
}): DropdownPosition {
  const spaceBelow = viewportHeight - rect.bottom - DROPDOWN_GAP;
  const spaceAbove = rect.top - DROPDOWN_GAP;
  if (spaceBelow < DROPDOWN_MAX_HEIGHT && spaceAbove > spaceBelow) {
    const dropdownHeight = Math.min(measuredHeight ?? DROPDOWN_MAX_HEIGHT, spaceAbove);
    return {
      top: rect.top - dropdownHeight - DROPDOWN_GAP,
      left: rect.left,
      width: rect.width,
      placement: "top",
    };
  }
  return {
    top: rect.bottom + DROPDOWN_GAP,
    left: rect.left,
    width: rect.width,
    placement: "bottom",
  };
}

function inputPlaceholderOf({
  isMissing,
  optionalHighlighting,
  isSourceMapping,
  inProgressPath,
  placeholder,
}: {
  isMissing: boolean;
  optionalHighlighting: boolean;
  isSourceMapping: boolean;
  inProgressPath: InProgressPath | null;
  placeholder: string;
}): string {
  if (isMissing && !optionalHighlighting) return "Required";
  if (isSourceMapping) return "";
  return inProgressPath ? "Select nested field..." : placeholder;
}

function sourceTagLabel({ source, path }: { source: AvailableSource; path: string[] }): string {
  if (source.id === "trace") return path.join(".");
  return `${source.name || source.id}.${path.join(".")}`;
}

// ============================================================================
// State transitions
// ============================================================================

/** Settle on a mapping and close the dropdown. */
function finishMapping({ setters, mapping }: { setters: MappingSetters; mapping: FieldMapping }) {
  setters.setLocalMapping(mapping);
  setters.setInProgressPath(null);
  setters.onMappingChange?.(mapping);
  setters.setIsOpen(false);
  setters.setSearchQuery("");
}

function clearMapping(setters: MappingSetters) {
  setters.setLocalMapping(undefined);
  setters.setInProgressPath(null);
  setters.onMappingChange?.(undefined);
  setters.setSearchQuery("");
  // Re-focus the input after clearing
  setTimeout(() => setters.focusInput(), 0);
}

/**
 * A field with children keeps the dropdown open on its children; a "complete"
 * one is also mapped right away, so "traces" is a valid value on its own.
 */
function selectOption({
  option,
  inProgressPath,
  setters,
}: {
  option: DropdownOption;
  inProgressPath: InProgressPath | null;
  setters: MappingSetters;
}) {
  if (option.type === "value") {
    finishMapping({ setters, mapping: { type: "value", value: option.value } });
    return;
  }
  const path = [...(inProgressPath?.path ?? []), option.field.name];
  const mapping: FieldMapping = { type: "source", sourceId: option.sourceId, path };
  if (!hasChildren(option.field)) {
    finishMapping({ setters, mapping });
    return;
  }
  if (isFieldComplete(option.field)) {
    setters.setLocalMapping(mapping);
    setters.onMappingChange?.(mapping);
  }
  setters.setInProgressPath({ sourceId: option.sourceId, path });
  setters.setSearchQuery("");
  setters.setHighlightedIndex(0);
}

/** Clear just the last path segment (for backspace on nested selection) */
function clearLastPathSegment({
  state,
  setters,
}: {
  state: MappingState;
  setters: MappingSetters;
}) {
  const { inProgressPath, localMapping } = state;
  if (inProgressPath && inProgressPath.path.length > 0) {
    const path = inProgressPath.path.slice(0, -1);
    setters.setInProgressPath(path.length === 0 ? null : { ...inProgressPath, path });
    setters.setSearchQuery("");
    return;
  }
  if (localMapping?.type === "source" && localMapping.path.length > 1) {
    const mapping: FieldMapping = {
      type: "source",
      sourceId: localMapping.sourceId,
      path: localMapping.path.slice(0, -1),
    };
    setters.setLocalMapping(mapping);
    setters.onMappingChange?.(mapping);
    return;
  }
  clearMapping(setters);
}

/** Typing searches; typing over a value mapping clears it. */
function changeQuery({
  value,
  state,
  setters,
}: {
  value: string;
  state: MappingState;
  setters: MappingSetters;
}) {
  setters.setSearchQuery(value);
  setters.setHighlightedIndex(0);
  setters.setIsOpen(true);
  if (state.localMapping?.type === "value") {
    setters.setLocalMapping(undefined);
    setters.onMappingChange?.(undefined);
  }
}

function navigateOpenDropdown({
  event,
  state,
  options,
  setters,
}: {
  event: KeyboardEvent<HTMLInputElement>;
  state: MappingState;
  options: DropdownOption[];
  setters: MappingSetters;
}) {
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      setters.setIsKeyboardNav(true);
      setters.setHighlightedIndex((prev) => (prev < options.length - 1 ? prev + 1 : prev));
      break;
    case "ArrowUp":
      event.preventDefault();
      setters.setIsKeyboardNav(true);
      setters.setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
      break;
    case "Enter": {
      event.preventDefault();
      const option = options[state.highlightedIndex];
      if (option) selectOption({ option, inProgressPath: state.inProgressPath, setters });
      break;
    }
    case "Escape":
      event.preventDefault();
      setters.setInProgressPath(null);
      setters.setIsOpen(false);
      setters.setSearchQuery("");
      break;
  }
}

/** Backspace on an empty query steps back; arrows open; the rest navigates. */
function handleMappingKey({
  event,
  state,
  options,
  setters,
}: {
  event: KeyboardEvent<HTMLInputElement>;
  state: MappingState;
  options: DropdownOption[];
  setters: MappingSetters;
}) {
  if (event.key === "Backspace" && state.searchQuery === "") {
    event.preventDefault();
    if (state.inProgressPath) clearLastPathSegment({ state, setters });
    else if (state.localMapping?.type === "source") clearMapping(setters);
    return;
  }
  if (state.isOpen) {
    navigateOpenDropdown({ event, state, options, setters });
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    setters.setIsOpen(true);
    setters.setIsKeyboardNav(true);
    event.preventDefault();
  }
}

function highlightOnMove({
  optionIndex,
  state,
  setters,
}: {
  optionIndex: number;
  state: MappingState;
  setters: MappingSetters;
}) {
  if (state.isKeyboardNav || state.highlightedIndex !== optionIndex) {
    setters.setIsKeyboardNav(false);
    setters.setHighlightedIndex(optionIndex);
  }
}

// ============================================================================
// Hooks
// ============================================================================

function useCloseOnOutsideClick({
  containerRef,
  dropdownRef,
  setIsOpen,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  dropdownRef: RefObject<HTMLDivElement | null>;
  setIsOpen: (open: boolean) => void;
}) {
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      const isOutsideContainer = containerRef.current && !containerRef.current.contains(target);
      const isOutsideDropdown = dropdownRef.current && !dropdownRef.current.contains(target);
      if (isOutsideContainer && isOutsideDropdown) setIsOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [containerRef, dropdownRef, setIsOpen]);
}

/** Position with flip behaviour, recalculated on open and after content changes. */
function useDropdownPosition({
  isOpen,
  containerRef,
  dropdownRef,
  filteredSources,
  inProgressPath,
}: {
  isOpen: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  dropdownRef: RefObject<HTMLDivElement | null>;
  filteredSources: AvailableSource[];
  inProgressPath: InProgressPath | null;
}): DropdownPosition {
  const [position, setPosition] = useState<DropdownPosition>({
    top: 0,
    left: 0,
    width: 0,
    placement: "bottom",
  });

  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;
    setPosition(
      dropdownPositionOf({
        rect: containerRef.current.getBoundingClientRect(),
        viewportHeight: window.innerHeight,
        measuredHeight: dropdownRef.current?.offsetHeight,
      }),
    );
  }, [containerRef, dropdownRef]);

  useEffect(() => {
    if (isOpen) updatePosition();
  }, [isOpen, updatePosition]);

  // requestAnimationFrame lets the DOM update first (nested navigation, filtering)
  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => updatePosition());
  }, [isOpen, filteredSources, inProgressPath, updatePosition]);

  // Scroll dropdown to top when navigating into nested fields
  useEffect(() => {
    if (dropdownRef.current && inProgressPath) dropdownRef.current.scrollTop = 0;
  }, [dropdownRef, inProgressPath]);

  return position;
}

function useVariableMapping({
  mapping,
  onMappingChange,
  availableSources,
}: {
  mapping: FieldMapping | undefined;
  onMappingChange: ((mapping: FieldMapping | undefined) => void) | undefined;
  availableSources: AvailableSource[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isKeyboardNav, setIsKeyboardNav] = useState(false);
  // Local state to track the current value - prevents stale prop issues
  const [localMapping, setLocalMapping] = useState<FieldMapping | undefined>(mapping);
  const [inProgressPath, setInProgressPath] = useState<InProgressPath | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync local mapping when prop changes (e.g., from external updates)
  const [mappingFrom, setMappingFrom] = useState(mapping);
  if (mappingFrom !== mapping) {
    setMappingFrom(mapping);
    setLocalMapping(mapping);
  }

  const sourceInfo = useMemo(() => {
    if (localMapping?.type !== "source") return null;
    const source = availableSources.find((s) => s.id === localMapping.sourceId);
    return source ? { source, path: localMapping.path } : null;
  }, [localMapping, availableSources]);

  const context = useMemo(
    () => dropdownContextOf({ availableSources, inProgressPath }),
    [availableSources, inProgressPath],
  );
  const filteredSources = useMemo(
    () => filterSources({ availableSources, searchQuery, context }),
    [availableSources, searchQuery, context],
  );
  const options = useMemo(
    () => optionsOf({ filteredSources, searchQuery, inProgressPath }),
    [filteredSources, searchQuery, inProgressPath],
  );

  // Reset highlighted index when options change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [options.length]);

  useCloseOnOutsideClick({ containerRef, dropdownRef, setIsOpen });
  const position = useDropdownPosition({
    isOpen,
    containerRef,
    dropdownRef,
    filteredSources,
    inProgressPath,
  });

  const state: MappingState = {
    localMapping,
    inProgressPath,
    searchQuery,
    isOpen,
    highlightedIndex,
    isKeyboardNav,
  };
  const setters: MappingSetters = {
    setLocalMapping,
    setInProgressPath,
    setSearchQuery,
    setIsOpen,
    setHighlightedIndex,
    setIsKeyboardNav,
    onMappingChange,
    focusInput: () => inputRef.current?.focus(),
  };

  return {
    state,
    setters,
    refs: { inputRef, dropdownRef, containerRef },
    sourceInfo,
    context,
    filteredSources,
    options,
    position,
  };
}

type MappingView = ReturnType<typeof useVariableMapping>;

// ============================================================================
// Main Component
// ============================================================================

export const VariableMappingInput = ({
  mapping,
  onMappingChange,
  availableSources,
  placeholder = "Enter value or select source...",
  disabled = false,
  isMissing = false,
  optionalHighlighting = false,
  inputTestId,
  renderSourceIcon,
}: VariableMappingInputProps) => {
  const view = useVariableMapping({ mapping, onMappingChange, availableSources });

  return (
    <Box position="relative" ref={view.refs.containerRef} width="full">
      <MappingField
        view={view}
        availableSources={availableSources}
        placeholder={placeholder}
        disabled={disabled}
        isMissing={isMissing}
        optionalHighlighting={optionalHighlighting}
        inputTestId={inputTestId}
        renderSourceIcon={renderSourceIcon}
      />
      {view.state.isOpen && !disabled && (
        <MappingDropdown view={view} renderSourceIcon={renderSourceIcon} />
      )}
    </Box>
  );
};

type MappingFieldProps = {
  view: MappingView;
  availableSources: AvailableSource[];
  placeholder: string;
  disabled: boolean;
  isMissing: boolean;
  optionalHighlighting: boolean;
  inputTestId: string | undefined;
  renderSourceIcon: RenderSourceIcon | undefined;
};

/** The frame's colours: orange while the mapping is missing, blue otherwise. */
function fieldFrameStyle(isMissing: boolean) {
  if (isMissing) {
    return {
      borderColor: "orange.emphasized",
      background: "orange.subtle",
      paddingX: 1,
      focusBorderColor: "orange.fg",
      focusShadow: "var(--chakra-colors-orange-emphasized) 0px 1px 0px 0px",
      placeholderColor: "orange.fg",
      testId: "missing-mapping-input",
    };
  }
  return {
    borderColor: "border",
    background: undefined,
    paddingX: undefined,
    focusBorderColor: "blue.500",
    focusShadow: "var(--chakra-colors-blue-500) 0px 1px 0px 0px",
    placeholderColor: undefined,
    testId: undefined,
  };
}

/** The input line: the mapped source as a tag, the nested path, and the query. */
function MappingField({
  view,
  availableSources,
  placeholder,
  disabled,
  isMissing,
  optionalHighlighting,
  inputTestId,
  renderSourceIcon,
}: MappingFieldProps) {
  const { state, setters, refs, sourceInfo, options } = view;
  const isSourceMapping = state.localMapping?.type === "source";
  const closedInputValue = state.localMapping?.type === "value" ? state.localMapping.value : "";
  const frame = fieldFrameStyle(isMissing);

  return (
    <Box
      borderBottom="1px solid"
      borderColor={frame.borderColor}
      background={frame.background}
      paddingX={frame.paddingX}
      _focusWithin={{ borderColor: frame.focusBorderColor, boxShadow: frame.focusShadow }}
      cursor={disabled ? "not-allowed" : "text"}
      onClick={() => {
        if (disabled) return;
        setters.setIsOpen(true);
        refs.inputRef.current?.focus();
      }}
      data-testid={frame.testId}
    >
      <HStack gap={1} paddingY={1} paddingX={1} flexWrap="wrap">
        {isSourceMapping && sourceInfo && !state.inProgressPath && (
          <SourceMappingTag
            sourceInfo={sourceInfo}
            renderSourceIcon={renderSourceIcon}
            onClear={() => {
              if (!disabled) clearMapping(setters);
            }}
          />
        )}

        {state.inProgressPath && (
          <PathSegmentTags
            inProgressPath={state.inProgressPath}
            source={availableSources.find((s) => s.id === state.inProgressPath?.sourceId)}
            disabled={disabled}
            setInProgressPath={setters.setInProgressPath}
            renderSourceIcon={renderSourceIcon}
          />
        )}

        <Input
          ref={refs.inputRef}
          value={state.isOpen ? state.searchQuery : closedInputValue}
          onChange={(e) => changeQuery({ value: e.target.value, state, setters })}
          onFocus={() => setters.setIsOpen(true)}
          onKeyDown={(event) => handleMappingKey({ event, state, options, setters })}
          placeholder={inputPlaceholderOf({
            isMissing,
            optionalHighlighting,
            isSourceMapping,
            inProgressPath: state.inProgressPath,
            placeholder,
          })}
          _placeholder={{ color: frame.placeholderColor }}
          size="sm"
          border="none"
          outline="none"
          borderRadius="none"
          background="transparent"
          _focus={{ boxShadow: "none", border: "none" }}
          _hover={{ border: "none" }}
          fontSize="13px"
          disabled={disabled}
          flex={1}
          minWidth={isSourceMapping || state.inProgressPath ? "20px" : undefined}
          height="24px"
          paddingX={0}
          data-testid={inputTestId}
        />
      </HStack>
    </Box>
  );
}

/** Source mapping displayed as a closable tag */
function SourceMappingTag({
  sourceInfo,
  renderSourceIcon,
  onClear,
}: {
  sourceInfo: { source: AvailableSource; path: string[] };
  renderSourceIcon: RenderSourceIcon | undefined;
  onClear: () => void;
}) {
  return (
    <Tag.Root size="md" colorPalette="blue" variant="subtle" data-testid="source-mapping-tag">
      {renderSourceIcon?.(sourceInfo.source.type)}
      <Tag.Label fontFamily="mono" fontSize="12px">
        {sourceTagLabel(sourceInfo)}
      </Tag.Label>
      <Tag.EndElement>
        <Tag.CloseTrigger
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          data-testid="clear-mapping-button"
        />
      </Tag.EndElement>
    </Tag.Root>
  );
}

/** In-progress path badges; closing one clears from that segment onwards. */
function PathSegmentTags({
  inProgressPath,
  source,
  disabled,
  setInProgressPath,
  renderSourceIcon,
}: {
  inProgressPath: InProgressPath;
  source: AvailableSource | undefined;
  disabled: boolean;
  setInProgressPath: (path: InProgressPath | null) => void;
  renderSourceIcon: RenderSourceIcon | undefined;
}) {
  const truncateAt = (index: number) => {
    if (disabled) return;
    setInProgressPath(
      index === 0 ? null : { ...inProgressPath, path: inProgressPath.path.slice(0, index) },
    );
  };

  return inProgressPath.path.map((segment, index) => (
    <HStack key={`${segment}-${index}`} gap={0}>
      <Tag.Root
        size="md"
        colorPalette="blue"
        variant="subtle"
        data-testid={`path-segment-tag-${index}`}
      >
        {index === 0 && source && renderSourceIcon?.(source.type)}
        <Tag.Label fontFamily="mono" fontSize="12px">
          {segment}
        </Tag.Label>
        <Tag.EndElement>
          <Tag.CloseTrigger
            onClick={(e) => {
              e.stopPropagation();
              truncateAt(index);
            }}
          />
        </Tag.EndElement>
      </Tag.Root>
      {index < inProgressPath.path.length - 1 && (
        <ChevronRight size={12} color="var(--chakra-colors-fg-muted)" />
      )}
    </HStack>
  ));
}

function MappingDropdown({
  view,
  renderSourceIcon,
}: {
  view: MappingView;
  renderSourceIcon: RenderSourceIcon | undefined;
}) {
  const { position, refs, options } = view;
  return (
    <Portal>
      <Box
        ref={refs.dropdownRef}
        position="fixed"
        top={`${position.top}px`}
        left={`${position.left}px`}
        width={`${Math.max(position.width, 280)}px`}
        maxHeight={`${DROPDOWN_MAX_HEIGHT}px`}
        overflowY="auto"
        background="bg.panel"
        borderRadius="8px"
        boxShadow="lg"
        border="1px solid"
        borderColor="border"
        zIndex={2000}
        // The list is portaled to the body. A modal dialog under the
        // drawer turns pointer events off outside itself, which would
        // leave the list visible but not clickable.
        pointerEvents="auto"
        data-testid="mapping-dropdown"
      >
        {options.length === 0 ? (
          <Box padding={3}>
            <Text fontSize="sm" color="fg.muted">
              No available sources
            </Text>
          </Box>
        ) : (
          <MappingOptions view={view} renderSourceIcon={renderSourceIcon} />
        )}
      </Box>
    </Portal>
  );
}

function MappingOptions({
  view,
  renderSourceIcon,
}: {
  view: MappingView;
  renderSourceIcon: RenderSourceIcon | undefined;
}) {
  const { state, filteredSources } = view;
  const firstIndexOf = filteredSources.map((_, sourceIndex) =>
    filteredSources.slice(0, sourceIndex).reduce((sum, source) => sum + source.fields.length, 0),
  );
  return (
    <VStack align="stretch" gap={0} padding={1}>
      {state.inProgressPath && state.inProgressPath.path.length > 0 && (
        <PathBreadcrumb path={state.inProgressPath.path} />
      )}
      <UseAllOption view={view} />
      {filteredSources.map((source, sourceIndex) => (
        <SourceOptions
          key={source.id}
          view={view}
          source={source}
          firstIndex={firstIndexOf[sourceIndex] ?? 0}
          renderSourceIcon={renderSourceIcon}
        />
      ))}
      <UseAsValueOption view={view} />
    </VStack>
  );
}

/** Show breadcrumb for nested selection */
function PathBreadcrumb({ path }: { path: string[] }) {
  return (
    <HStack
      paddingX={2}
      paddingY={1}
      gap={1}
      background="blue.subtle"
      borderRadius="4px"
      marginBottom={1}
    >
      <Text fontSize="xs" color="blue.600">
        {path.map((s) => s.replace(/_/g, " ")).join(" → ")}
      </Text>
      <Text fontSize="xs" color="blue.400">
        →
      </Text>
    </HStack>
  );
}

/** "Use all X" option when parent is complete */
function UseAllOption({ view }: { view: MappingView }) {
  const { context, state, setters } = view;
  if (!context.isParentComplete || !context.parentFieldName) return null;
  const selectCurrentPath = () => {
    if (!state.inProgressPath) return;
    finishMapping({
      setters,
      mapping: {
        type: "source",
        sourceId: state.inProgressPath.sourceId,
        path: state.inProgressPath.path,
      },
    });
  };
  return (
    <HStack
      paddingX={3}
      paddingY={2}
      gap={2}
      cursor="pointer"
      borderRadius="4px"
      background={state.highlightedIndex === -1 ? "blue.subtle" : "transparent"}
      _hover={{ background: "blue.subtle" }}
      onClick={selectCurrentPath}
      onMouseMove={() => highlightOnMove({ optionIndex: -1, state, setters })}
      data-testid="use-all-option"
      borderBottom="1px solid"
      borderColor="border.muted"
      marginBottom={1}
    >
      <Check size={12} color="var(--chakra-colors-green-fg)" />
      <Text fontSize="13px" fontWeight="medium" color="green.fg">
        {context.parentIsCompleteLabel ?? `Use all ${context.parentFieldName}`}
      </Text>
    </HStack>
  );
}

function SourceOptions({
  view,
  source,
  firstIndex,
  renderSourceIcon,
}: {
  view: MappingView;
  source: AvailableSource;
  firstIndex: number;
  renderSourceIcon: RenderSourceIcon | undefined;
}) {
  const { state } = view;
  return (
    <Box>
      {/* Source header - only show at top level */}
      {!state.inProgressPath && (
        <HStack
          paddingX={2}
          paddingY={1}
          gap={2}
          background="bg.subtle"
          borderRadius="4px"
          marginBottom={1}
        >
          {renderSourceIcon?.(source.type)}
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
            {source.name}
          </Text>
        </HStack>
      )}
      {source.fields.map((field, fieldIndex) => (
        <FieldOption
          key={`${source.id}-${field.name}`}
          view={view}
          source={source}
          field={field}
          optionIndex={firstIndex + fieldIndex}
        />
      ))}
    </Box>
  );
}

function FieldOption({
  view,
  source,
  field,
  optionIndex,
}: {
  view: MappingView;
  source: AvailableSource;
  field: NestedField;
  optionIndex: number;
}) {
  const { state, setters } = view;
  const isHighlighted = optionIndex === state.highlightedIndex;
  return (
    <HStack
      paddingX={3}
      paddingY={2}
      gap={2}
      cursor="pointer"
      borderRadius="4px"
      background={isHighlighted ? "blue.subtle" : "transparent"}
      onMouseMove={() => highlightOnMove({ optionIndex, state, setters })}
      onClick={() =>
        selectOption({
          option: {
            type: "field",
            sourceId: source.id,
            sourceName: source.name,
            sourceType: source.type,
            field,
          },
          inProgressPath: state.inProgressPath,
          setters,
        })
      }
      data-highlighted={isHighlighted}
      data-testid={`field-option-${field.name}`}
    >
      <VariableTypeIcon type={field.type} size={12} />
      <Text fontSize="13px" fontFamily="mono" flex={1}>
        <FieldOptionLabel label={field.label ?? field.name ?? ""} />
      </Text>
      {hasChildren(field) ? (
        <ChevronRight size={14} color="var(--chakra-colors-fg-muted)" />
      ) : (
        <VariableTypeBadge type={field.type} size="xs" />
      )}
    </HStack>
  );
}

/** Render "* (description)" with gray parenthesis part */
function FieldOptionLabel({ label }: { label: string }) {
  if (!label.startsWith("* (") || !label.endsWith(")")) return label;
  return (
    <>
      *{" "}
      <Text as="span" color="fg.muted">
        {label.slice(2)}
      </Text>
    </>
  );
}

/** "Use as value" option when user typed something (only at top level) */
function UseAsValueOption({ view }: { view: MappingView }) {
  const { state, setters, options, filteredSources } = view;
  const typed = state.searchQuery.trim();
  if (!typed || state.inProgressPath) return null;
  const valueOptionIndex = options.length - 1;
  const isHighlighted = state.highlightedIndex === valueOptionIndex;
  return (
    <Box>
      {filteredSources.length > 0 && <Box height="1px" background="border" marginY={1} />}
      <HStack
        paddingX={3}
        paddingY={2}
        gap={2}
        cursor="pointer"
        borderRadius="4px"
        background={isHighlighted ? "blue.subtle" : "transparent"}
        onMouseMove={() => highlightOnMove({ optionIndex: valueOptionIndex, state, setters })}
        onClick={() =>
          selectOption({
            option: { type: "value", value: typed },
            inProgressPath: state.inProgressPath,
            setters,
          })
        }
        data-highlighted={isHighlighted}
        data-testid="use-as-value-option"
      >
        <Type size={14} color="var(--chakra-colors-gray-500)" />
        <Text fontSize="13px" color="fg.muted">
          Use "
          <Text as="span" fontWeight="medium" color="fg">
            {typed}
          </Text>
          " as value
        </Text>
      </HStack>
    </Box>
  );
}
