/**
 * SavedViewsBar -- fixed bottom bar showing filter presets for the traces page.
 *
 * Displays default origin-based views and user-defined custom views.
 * Supports edit mode for renaming, deleting, and reordering custom views.
 * Uses @dnd-kit for drag-and-drop reordering in edit mode.
 */

import {
  Badge,
  Box,
  Button,
  HStack,
  IconButton,
  Input,
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
import { MoreVertical, X } from "lucide-react";
import React, { useCallback, useRef, useState } from "react";
import type { DefaultView, SavedView } from "../../hooks/useSavedViews";
import { useSavedViews } from "../../hooks/useSavedViews";
import { getOriginColor } from "../../utils/originColors";
import { getColorForString } from "../../utils/rotatingColors";
import { Menu } from "../ui/menu";

/**
 * Returns badge colors for a view.
 * Default views use origin-based colors; custom views use hash-based colors.
 */
function getViewColors(
  view: { origin?: string | null; name: string },
  isDefault: boolean,
): { background: string; color: string } {
  if (isDefault && view.origin === null) {
    return { background: "gray.subtle", color: "gray.emphasized" };
  }
  if (isDefault && view.origin) {
    return getOriginColor(view.origin);
  }
  return getColorForString("colors", view.name);
}

/**
 * SavedViewsBar renders a fixed bar at the bottom of the traces page
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

  return (
    <Box
      position="fixed"
      bottom={0}
      left={0}
      right={0}
      zIndex={1000}
      background="bg.panel"
      borderTop="1px solid"
      borderColor="border"
      paddingX={6}
      paddingY={2}
      data-testid="saved-views-bar"
    >
      <HStack gap={2} overflowX="auto" width="full">
        {/* Default views */}
        {defaultViews.map((view) => (
          <ViewBadge
            key={view.id}
            id={view.id}
            name={view.name}
            colors={getViewColors(view, true)}
            isSelected={selectedViewId === view.id}
            isDefault={true}
            isEditMode={isEditMode}
            onClick={() => {
              if (!isEditMode) handleViewClick(view.id);
            }}
          />
        ))}

        {/* Custom views with drag-and-drop */}
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

        {/* Edit mode hint */}
        {isEditMode && customViews.length > 0 && (
          <Text fontSize="xs" color="fg.subtle" flexShrink={0}>
            Double click to rename
          </Text>
        )}

        {/* Spacer */}
        <Box flex={1} />

        {/* Three-dot menu */}
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
            <Menu.Item
              value={isEditMode ? "done" : "edit"}
              onClick={() => setIsEditMode(!isEditMode)}
            >
              {isEditMode ? "Done" : "Edit"}
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </HStack>
    </Box>
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
          <Input
            ref={inputRef}
            size="xs"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRenameConfirm}
            onKeyDown={handleKeyDown}
            width="auto"
            minWidth="60px"
            maxWidth="150px"
            height="18px"
            fontSize="xs"
            padding={0}
            variant="flushed"
            onClick={(e) => e.stopPropagation()}
            data-testid={`rename-input-${id}`}
          />
        ) : (
          <Text>{name}</Text>
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
              onDelete?.();
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

  const colors = getViewColors(view, false);

  return (
    <ViewBadge
      id={view.id}
      name={view.name}
      colors={colors}
      isSelected={isSelected}
      isDefault={false}
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
