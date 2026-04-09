/**
 * SavedViewsBar -- sticky bottom bar showing filter presets for the traces page.
 *
 * Displays "All Traces" as a permanent view and user-defined custom views
 * (including seeded origin views) with drag-and-drop reordering in edit mode.
 * Uses @dnd-kit for drag-and-drop reordering in edit mode.
 */

import {
  Badge,
  Box,
  Button,
  HStack,
  IconButton,
  Input,
  Portal,
  useBreakpointValue,
  Text,
} from "@chakra-ui/react";
import {
  closestCenter,
  DndContext,
  type DraggableAttributes,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, MoreVertical, User, X } from "lucide-react";
import React, { useCallback, useRef, useState } from "react";
import type { SavedView } from "../../hooks/useSavedViews";
import { useSavedViews } from "../../hooks/useSavedViews";
import { getOriginColor } from "../../utils/originColors";
import { getColorForString } from "../../utils/rotatingColors";
import { MENU_WIDTH_COMPACT, MENU_WIDTH_EXPANDED } from "../MainMenu";
import { Menu } from "../ui/menu";

/**
 * Returns badge colors for a view.
 * Views that filter on a single origin value reuse the origin column colors.
 * Other custom views use hash-based colors from the rotating palette.
 */
function getViewColors(view: { filters: SavedView["filters"]; name: string }): {
  background: string;
  color: string;
} {
  const originFilter = view.filters["traces.origin"];
  if (Array.isArray(originFilter) && originFilter.length === 1) {
    return getOriginColor(originFilter[0]!);
  }
  return getColorForString("colors", view.name);
}

/**
 * SavedViewsBar renders a sticky bar at the bottom of the traces page
 * with clickable view badges for quick filter switching.
 */
export function SavedViewsBar() {
  const {
    defaultViews,
    customViews,
    selectedViewId,
    handleViewClick,
    deleteView,
    renameView,
    reorderViews,
  } = useSavedViews();

  const [isEditMode, setIsEditMode] = useState(false);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = customViews.findIndex((v) => v.id === active.id);
      const newIndex = customViews.findIndex((v) => v.id === over.id);

      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = arrayMove(customViews, oldIndex, newIndex);
      reorderViews(newOrder);
    },
    [customViews, reorderViews],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const allTracesView = defaultViews[0];
  const isSmallScreen = useBreakpointValue({ base: true, lg: false });
  const menuWidth = isSmallScreen ? MENU_WIDTH_COMPACT : MENU_WIDTH_EXPANDED;

  return (
    <Portal>
      <Box
        position="fixed"
        bottom={0}
        left={menuWidth}
        right={0}
        zIndex={10}
        background="bg.panel/75"
        backdropFilter="blur(8px)"
        borderTop="1px solid"
        borderColor="border"
        paddingX={6}
        paddingY={2}
        data-testid="saved-views-bar"
      >
      <HStack gap={2} overflowX="auto" width="full">
        {/* All Traces -- always first, never deletable */}
        {allTracesView && (
          <ViewBadge
            id={allTracesView.id}
            name={allTracesView.name}
            colors={{ background: "gray.subtle", color: "gray.emphasized" }}
            isSelected={selectedViewId === allTracesView.id}
            isDefault={true}
            isEditMode={isEditMode}
            onClick={() => {
              if (!isEditMode) handleViewClick(allTracesView.id);
            }}
          />
        )}

        {/* Custom views (including seeded origin views) with drag-and-drop */}
        {customViews.length > 0 && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={customViews.map((v) => v.id)}
              strategy={horizontalListSortingStrategy}
              disabled={!isEditMode}
            >
              {customViews.map((view) => (
                <SortableViewBadge
                  key={view.id}
                  view={view}
                  isSelected={selectedViewId === view.id}
                  isEditMode={isEditMode}
                  onClick={() => {
                    if (!isEditMode) handleViewClick(view.id);
                  }}
                  onDelete={() => deleteView(view.id)}
                  onRename={(newName) => renameView(view.id, newName)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}

        {/* Spacer pushes hint and button to the right */}
        <Box flex={1} />

        {/* Edit mode hint */}
        {isEditMode && customViews.length > 0 && (
          <Text fontSize="xs" color="fg.subtle" flexShrink={0}>
            Double click to rename
          </Text>
        )}

        {/* Edit mode toggle */}
        {isEditMode ? (
          <Button
            size="xs"
            colorPalette="blue"
            onClick={() => setIsEditMode(false)}
            flexShrink={0}
            data-testid="saved-views-done-button"
          >
            Done
          </Button>
        ) : (
          <Menu.Root>
            <Menu.Trigger asChild>
              <IconButton
                aria-label="View options"
                variant="ghost"
                size="xs"
                data-testid="saved-views-menu"
              >
                <MoreVertical size={16} />
              </IconButton>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item value="edit" onClick={() => setIsEditMode(true)}>
                Edit
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        )}
      </HStack>
      </Box>
    </Portal>
  );
}

/**
 * ViewBadge renders a single view badge in the bar.
 * Shows selection state and optional delete button in edit mode.
 */
function ViewBadge({
  id,
  name,
  colors,
  isSelected,
  isDefault,
  isPersonal,
  isEditMode,
  onClick,
  onDelete,
  onRename,
  style,
  dragRef,
  dragListeners,
  dragAttributes,
}: {
  id: string;
  name: string;
  colors: { background: string; color: string };
  isSelected: boolean;
  isDefault: boolean;
  isPersonal?: boolean;
  isEditMode: boolean;
  onClick: () => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
  style?: React.CSSProperties;
  dragRef?: (element: HTMLElement | null) => void;
  dragListeners?: SyntheticListenerMap;
  dragAttributes?: DraggableAttributes;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [editName, setEditName] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClick = useCallback(() => {
    if (!isEditMode || isDefault) return;
    setIsRenaming(true);
    setEditName(name);
    // Focus input after render
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [isEditMode, isDefault, name]);

  const handleRenameConfirm = useCallback(() => {
    setIsRenaming(false);
    const trimmed = editName.trim();
    if (trimmed && trimmed !== name && onRename) {
      onRename(trimmed);
    }
  }, [editName, name, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleRenameConfirm();
      } else if (e.key === "Escape") {
        setIsRenaming(false);
        setEditName(name);
      }
    },
    [handleRenameConfirm, name],
  );

  return (
    <Badge
      ref={dragRef}
      style={style}
      {...(dragListeners ?? {})}
      {...(dragAttributes ?? {})}
      variant="subtle"
      cursor={isEditMode ? (isDefault ? "default" : "grab") : "pointer"}
      onClick={onClick}
      onDoubleClick={handleDoubleClick}
      paddingX={3}
      paddingY={1}
      borderRadius="full"
      fontSize="xs"
      fontWeight="medium"
      userSelect="none"
      whiteSpace="nowrap"
      background={isSelected ? colors.background : "transparent"}
      color={isSelected ? colors.color : "fg.muted"}
      borderWidth="1px"
      borderColor={isSelected ? colors.color : "border"}
      opacity={isSelected ? 1 : 0.7}
      _hover={
        isEditMode
          ? {}
          : {
              opacity: 1,
              background: colors.background,
              color: colors.color,
              borderColor: colors.color,
            }
      }
      transition="all 0.15s ease"
      data-testid={`saved-view-badge-${id}`}
      data-selected={isSelected}
    >
      <HStack gap={1}>
        {isRenaming ? (
          <>
            <Input
              ref={inputRef}
              size="xs"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleRenameConfirm}
              onKeyDown={handleKeyDown}
              width={`${Math.max(editName.length * 8, 60)}px`}
              minWidth="60px"
              maxWidth="150px"
              height="18px"
              fontSize="xs"
              padding={0}
              onClick={(e) => e.stopPropagation()}
              data-testid={`rename-input-${id}`}
            />
            <IconButton
              aria-label="Confirm rename"
              variant="ghost"
              size="2xs"
              minWidth="14px"
              height="14px"
              onClick={(e) => {
                e.stopPropagation();
                handleRenameConfirm();
              }}
              data-testid={`confirm-rename-${id}`}
            >
              <Check size={10} />
            </IconButton>
          </>
        ) : (
          <>
            {isPersonal && <User size={10} />}
            <Text>{name}</Text>
          </>
        )}
        {isEditMode && !isDefault && !isRenaming && (
          <IconButton
            aria-label={`Delete ${name}`}
            variant="ghost"
            size="2xs"
            minWidth="14px"
            height="14px"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(`Delete "${name}" saved view?`)) {
                onDelete?.();
              }
            }}
            data-testid={`delete-view-${id}`}
          >
            <X size={10} />
          </IconButton>
        )}
      </HStack>
    </Badge>
  );
}

/**
 * SortableViewBadge wraps ViewBadge with @dnd-kit sortable functionality.
 */
function SortableViewBadge({
  view,
  isSelected,
  isEditMode,
  onClick,
  onDelete,
  onRename,
}: {
  view: SavedView;
  isSelected: boolean;
  isEditMode: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (newName: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: view.id, disabled: !isEditMode });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 10 : undefined,
  };

  const colors = getViewColors(view);

  return (
    <ViewBadge
      id={view.id}
      name={view.name}
      colors={colors}
      isSelected={isSelected}
      isDefault={false}
      isPersonal={!!view.userId}
      isEditMode={isEditMode}
      onClick={onClick}
      onDelete={onDelete}
      onRename={onRename}
      style={style}
      dragRef={setNodeRef}
      dragListeners={isEditMode ? listeners : undefined}
      dragAttributes={isEditMode ? attributes : undefined}
    />
  );
}
