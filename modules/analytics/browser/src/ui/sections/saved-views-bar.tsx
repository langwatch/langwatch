/**
 * The strip of saved filter views pinned to the bottom of an analytics page: "All Traces" first,
 * then the project's custom views, which reorder by drag and rename or delete in edit mode.
 */

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DraggableAttributes,
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
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Menu } from "@langwatch/design-system/menu";
import {
  Badge,
  Box,
  Button,
  HStack,
  IconButton,
  Input,
  Text,
} from "@langwatch/design-system/primitives";
import { Check, MoreVertical, User, X } from "lucide-react";
import type React from "react";
import { useCallback, useRef, useState } from "react";

import { useSavedViews } from "../../behavior/use-saved-views.tsx";
import { type ViewBadgeColors, viewBadgeColors } from "../../model/saved-view-colors.ts";
import type { SavedView } from "../../model/saved-views-logic.ts";

function badgeCursor({ isEditMode, isDefault }: { isEditMode: boolean; isDefault: boolean }) {
  if (!isEditMode) return "pointer";
  return isDefault ? "default" : "grab";
}

type ViewBadgeProps = {
  id: string;
  name: string;
  colors: ViewBadgeColors;
  isSelected: boolean;
  isDefault: boolean;
  isPersonal?: boolean;
  isEditMode: boolean;
  onClick: () => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
  style?: React.CSSProperties;
  dragRef?: (element: HTMLElement | null) => void;
  dragListeners?: SyntheticListenerMap | undefined;
  dragAttributes?: DraggableAttributes | undefined;
};

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
}: ViewBadgeProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [editName, setEditName] = useState(name);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClick = useCallback(() => {
    if (!isEditMode || isDefault) return;
    setIsRenaming(true);
    setEditName(name);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [isEditMode, isDefault, name]);

  const handleRenameConfirm = useCallback(() => {
    setIsRenaming(false);
    const trimmed = editName.trim();
    if (trimmed && trimmed !== name && onRename) onRename(trimmed);
  }, [editName, name, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleRenameConfirm();
      else if (e.key === "Escape") {
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
      cursor={badgeCursor({ isEditMode, isDefault })}
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
              setIsConfirmDeleteOpen(true);
            }}
            data-testid={`delete-view-${id}`}
          >
            <X size={10} />
          </IconButton>
        )}
      </HStack>
      <ConfirmDialog
        open={isConfirmDeleteOpen}
        onOpenChange={setIsConfirmDeleteOpen}
        title="Delete saved view"
        message={`Delete "${name}" saved view?`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          setIsConfirmDeleteOpen(false);
          onDelete?.();
        }}
      />
    </Badge>
  );
}

type SortableViewBadgeProps = {
  view: SavedView;
  isSelected: boolean;
  isEditMode: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (newName: string) => void;
};

function SortableViewBadge({
  view,
  isSelected,
  isEditMode,
  onClick,
  onDelete,
  onRename,
}: SortableViewBadgeProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: view.id,
    disabled: !isEditMode,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <ViewBadge
      id={view.id}
      name={view.name}
      colors={viewBadgeColors(view)}
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

function EditModeControls({
  isEditMode,
  hasCustomViews,
  onEdit,
  onDone,
}: {
  isEditMode: boolean;
  hasCustomViews: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  if (!isEditMode) {
    return (
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
          <Menu.Item value="edit" onClick={onEdit}>
            Edit
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    );
  }
  return (
    <>
      {hasCustomViews && (
        <Text fontSize="xs" color="fg.subtle" flexShrink={0}>
          Double click to rename
        </Text>
      )}
      <Button
        size="xs"
        colorPalette="blue"
        onClick={onDone}
        flexShrink={0}
        data-testid="saved-views-done-button"
      >
        Done
      </Button>
    </>
  );
}

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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (!over || active.id === over.id) return;
      const oldIndex = customViews.findIndex((v) => v.id === active.id);
      const newIndex = customViews.findIndex((v) => v.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      reorderViews(arrayMove(customViews, oldIndex, newIndex));
    },
    [customViews, reorderViews],
  );

  const allTracesView = defaultViews[0];

  return (
    <Box
      position="sticky"
      bottom={0}
      zIndex="sticky"
      background="bg.panel/75"
      backdropFilter="blur(8px)"
      borderTop="1px solid"
      borderColor="border"
      paddingX={6}
      paddingY={2}
      data-testid="saved-views-bar"
    >
      <HStack gap={2} overflowX="auto" width="full">
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
        <Box flex={1} />
        <EditModeControls
          isEditMode={isEditMode}
          hasCustomViews={customViews.length > 0}
          onEdit={() => setIsEditMode(true)}
          onDone={() => setIsEditMode(false)}
        />
      </HStack>
    </Box>
  );
}
