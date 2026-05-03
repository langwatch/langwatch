import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Spinner,
  Text,
  VStack,
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
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus } from "lucide-react";
import type React from "react";

import type { AiToolEntry } from "~/components/me/tiles/types";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

const SECTION_LABELS: Record<AiToolEntry["type"], string> = {
  coding_assistant: "Coding assistants",
  model_provider: "Model providers",
  external_tool: "Internal tools",
};

const SECTION_ORDER: AiToolEntry["type"][] = [
  "coding_assistant",
  "model_provider",
  "external_tool",
];

interface Props {
  organizationId: string;
  onAddTile: (type: AiToolEntry["type"]) => void;
  onEditTile: (entry: AiToolEntry) => void;
}

export function ToolCatalogEditor({
  organizationId,
  onAddTile,
  onEditTile,
}: Props) {
  const utils = api.useUtils();

  const adminListQuery = api.aiTools.adminList.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );

  const setEnabledMutation = api.aiTools.setEnabled.useMutation({
    onSuccess: () => {
      void utils.aiTools.adminList.invalidate({ organizationId });
      void utils.aiTools.list.invalidate({ organizationId });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to update tile",
        description: err.message,
        type: "error",
      });
    },
  });

  const reorderMutation = api.aiTools.reorder.useMutation({
    onSuccess: () => {
      void utils.aiTools.list.invalidate({ organizationId });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to reorder",
        description: err.message,
        type: "error",
      });
    },
  });

  if (adminListQuery.isLoading) {
    return (
      <HStack padding={6} justifyContent="center">
        <Spinner size="sm" />
        <Text fontSize="sm" color="fg.muted">
          Loading catalog…
        </Text>
      </HStack>
    );
  }

  const entries = (adminListQuery.data ?? []) as unknown as AiToolEntry[];

  const grouped: Record<AiToolEntry["type"], AiToolEntry[]> = {
    coding_assistant: [],
    model_provider: [],
    external_tool: [],
  };
  for (const e of entries) grouped[e.type].push(e);
  for (const t of SECTION_ORDER) {
    grouped[t].sort((a, b) => a.order - b.order);
  }

  const handleSectionDragEnd =
    (type: AiToolEntry["type"]) => (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const items = grouped[type];
      const oldIndex = items.findIndex((e) => e.id === active.id);
      const newIndex = items.findIndex((e) => e.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reorderedSection = arrayMove(items, oldIndex, newIndex).map(
        (e, idx) => ({ ...e, order: idx }),
      );

      const previous = entries;
      const next: AiToolEntry[] = entries.map((e) => {
        if (e.type !== type) return e;
        const updated = reorderedSection.find((r) => r.id === e.id);
        return updated ?? e;
      });

      utils.aiTools.adminList.setData(
        { organizationId },
        next as unknown as typeof adminListQuery.data,
      );

      reorderMutation.mutate(
        {
          organizationId,
          updates: reorderedSection.map((e) => ({ id: e.id, order: e.order })),
        },
        {
          onError: () => {
            utils.aiTools.adminList.setData(
              { organizationId },
              previous as unknown as typeof adminListQuery.data,
            );
          },
        },
      );
    };

  return (
    <VStack align="stretch" gap={6} width="full">
      {SECTION_ORDER.map((type) => {
        const items = grouped[type];
        return (
          <VStack key={type} align="stretch" gap={2}>
            <HStack>
              <Heading as="h3" size="sm">
                {SECTION_LABELS[type]} ({items.length})
              </Heading>
              <Button
                size="xs"
                variant="outline"
                marginLeft="auto"
                onClick={() => onAddTile(type)}
              >
                <Plus size={14} /> Add tile
              </Button>
            </HStack>

            {items.length === 0 ? (
              <Box
                borderWidth="1px"
                borderColor="border.muted"
                borderRadius="sm"
                padding={4}
                backgroundColor="bg.subtle"
              >
                <Text fontSize="xs" color="fg.muted">
                  No {SECTION_LABELS[type].toLowerCase()} configured. Click{" "}
                  <strong>Add tile</strong> to publish one.
                </Text>
              </Box>
            ) : (
              <SortableSection
                items={items}
                onDragEnd={handleSectionDragEnd(type)}
                onEdit={onEditTile}
                onToggleEnabled={(entry) =>
                  setEnabledMutation.mutate({
                    organizationId,
                    id: entry.id,
                    enabled: !entry.enabled,
                  })
                }
                togglePendingId={
                  setEnabledMutation.isPending
                    ? setEnabledMutation.variables?.id
                    : undefined
                }
              />
            )}
          </VStack>
        );
      })}
    </VStack>
  );
}

function SortableSection({
  items,
  onDragEnd,
  onEdit,
  onToggleEnabled,
  togglePendingId,
}: {
  items: AiToolEntry[];
  onDragEnd: (event: DragEndEvent) => void;
  onEdit: (entry: AiToolEntry) => void;
  onToggleEnabled: (entry: AiToolEntry) => void;
  togglePendingId?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={items.map((e) => e.id)}
        strategy={verticalListSortingStrategy}
      >
        <VStack align="stretch" gap={1}>
          {items.map((entry) => (
            <SortableCatalogRow
              key={entry.id}
              entry={entry}
              onEdit={() => onEdit(entry)}
              onToggleEnabled={() => onToggleEnabled(entry)}
              isPending={togglePendingId === entry.id}
            />
          ))}
        </VStack>
      </SortableContext>
    </DndContext>
  );
}

function SortableCatalogRow({
  entry,
  onEdit,
  onToggleEnabled,
  isPending,
}: {
  entry: AiToolEntry;
  onEdit: () => void;
  onToggleEnabled: () => void;
  isPending: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : entry.enabled ? 1 : 0.5,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <CatalogRow
      entry={entry}
      onEdit={onEdit}
      onToggleEnabled={onToggleEnabled}
      isPending={isPending}
      style={style}
      dragRef={setNodeRef}
      dragListeners={listeners}
      dragAttributes={attributes}
    />
  );
}

function CatalogRow({
  entry,
  onEdit,
  onToggleEnabled,
  isPending,
  style,
  dragRef,
  dragListeners,
  dragAttributes,
}: {
  entry: AiToolEntry;
  onEdit: () => void;
  onToggleEnabled: () => void;
  isPending: boolean;
  style?: React.CSSProperties;
  dragRef?: (element: HTMLElement | null) => void;
  dragListeners?: SyntheticListenerMap;
  dragAttributes?: DraggableAttributes;
}) {
  const scopeLabel =
    entry.scope === "organization"
      ? "Org-wide"
      : `Team: ${entry.scopeId.slice(0, 12)}`;

  return (
    <HStack
      ref={dragRef}
      style={style}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="sm"
      padding={2}
      gap={2}
      backgroundColor="bg.panel"
      data-testid={`catalog-row-${entry.id}`}
    >
      <Box
        color="fg.muted"
        cursor="grab"
        {...(dragListeners ?? {})}
        {...(dragAttributes ?? {})}
        aria-label="Drag to reorder"
      >
        <GripVertical size={16} />
      </Box>
      <Text fontSize="sm" flex={1} fontWeight="medium">
        {entry.displayName}
      </Text>
      <Badge variant="subtle" colorPalette="gray" fontSize="xs">
        {scopeLabel}
      </Badge>
      <Button size="xs" variant="ghost" onClick={onEdit}>
        Edit
      </Button>
      <Button
        size="xs"
        variant="ghost"
        onClick={onToggleEnabled}
        disabled={isPending}
      >
        {entry.enabled ? "Disable" : "Enable"}
      </Button>
    </HStack>
  );
}
