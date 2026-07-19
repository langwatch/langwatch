import {
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
import {
  GripVertical,
  MoreVertical,
  PackageOpen,
  Pencil,
  Plus,
  Power,
  Trash2,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";

import { ProviderScopeChips } from "~/components/settings/ProviderScopeChips";
import type { AiToolEntry } from "~/components/me/tiles/types";
import { Checkbox } from "~/components/ui/checkbox";
import { Dialog } from "~/components/ui/dialog";
import { Menu } from "~/components/ui/menu";
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

  // Delete is permanent, so it routes through a confirm dialog. `null`
  // means no pending deletion; a non-null entry is the tile awaiting
  // confirmation.
  const [pendingDelete, setPendingDelete] = useState<AiToolEntry | null>(null);

  const adminListQuery = api.aiTools.adminList.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );

  const departmentsQuery = api.departments.list.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );
  const departmentNameById = useMemo(
    () => new Map((departmentsQuery.data ?? []).map((d) => [d.id, d.name])),
    [departmentsQuery.data],
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

  const removeMutation = api.aiTools.remove.useMutation({
    onSuccess: () => {
      void utils.aiTools.adminList.invalidate({ organizationId });
      void utils.aiTools.list.invalidate({ organizationId });
      toaster.create({ title: "Tile deleted", type: "success" });
      setPendingDelete(null);
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to delete tile",
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

  const importStarterPackMutation = api.aiTools.importStarterPack.useMutation({
    onSuccess: ({ created, skipped }) => {
      void utils.aiTools.adminList.invalidate({ organizationId });
      void utils.aiTools.list.invalidate({ organizationId });
      toaster.create({
        title:
          created === 0
            ? "Starter pack already published"
            : `Imported ${created} ${created === 1 ? "tile" : "tiles"}`,
        description:
          skipped > 0
            ? `${skipped} ${skipped === 1 ? "tile was" : "tiles were"} already published and skipped.`
            : "Coding assistants and model providers are now visible to your team on /me.",
        type: "success",
      });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to import starter pack",
        description: err.message,
        type: "error",
      });
    },
  });

  const starterPackQuery = api.aiTools.starterPackCatalog.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );

  // A slug is selected unless the admin explicitly unchecks it, so the
  // checklist defaults to the full pack without waiting on the query.
  const [unchecked, setUnchecked] = useState<Record<string, boolean>>({});
  const starterTiles = starterPackQuery.data ?? [];
  const selectedSlugs = starterTiles
    .filter((t) => !unchecked[t.slug])
    .map((t) => t.slug);

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

  const isCatalogEmpty = entries.length === 0;

  return (
    <VStack align="stretch" gap={6} width="full">
      {isCatalogEmpty && (
        <Box
          borderWidth="1px"
          borderColor="orange.300"
          borderRadius="md"
          backgroundColor="orange.50"
          padding={4}
        >
          <HStack alignItems="start" gap={3}>
            <Box color="orange.600" paddingTop="2px">
              <PackageOpen size={20} />
            </Box>
            <VStack align="start" gap={2} flex={1} minWidth={0}>
              <Text fontSize="sm" fontWeight="semibold">
                Publish a starter pack to get going
              </Text>
              <Text fontSize="xs" color="fg.muted">
                Pick the tools to publish at org scope so every member sees
                them on /me. You can rename, reorder, disable, or remove
                individual tiles afterwards. Re-running is safe; only new
                slugs get added.
              </Text>
              <VStack align="start" gap={2} paddingTop={1} width="full">
                {SECTION_ORDER.map((type) => {
                  const tiles = starterTiles.filter((t) => t.type === type);
                  if (tiles.length === 0) return null;
                  return (
                    <VStack key={type} align="start" gap={1}>
                      <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                        {SECTION_LABELS[type]}
                      </Text>
                      {tiles.map((tile) => (
                        <Checkbox
                          key={tile.slug}
                          size="sm"
                          checked={!unchecked[tile.slug]}
                          onChange={(e) =>
                            setUnchecked((prev) => ({
                              ...prev,
                              [tile.slug]: !e.target.checked,
                            }))
                          }
                        >
                          <Text fontSize="sm">{tile.displayName}</Text>
                        </Checkbox>
                      ))}
                    </VStack>
                  );
                })}
              </VStack>
              <HStack paddingTop={1}>
                <Button
                  size="sm"
                  colorPalette="orange"
                  loading={importStarterPackMutation.isPending}
                  disabled={selectedSlugs.length === 0}
                  onClick={() =>
                    importStarterPackMutation.mutate({
                      organizationId,
                      slugs: selectedSlugs,
                    })
                  }
                >
                  <PackageOpen size={14} /> Import selected (
                  {selectedSlugs.length})
                </Button>
              </HStack>
            </VStack>
          </HStack>
        </Box>
      )}
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
                departmentNameById={departmentNameById}
                onDragEnd={handleSectionDragEnd(type)}
                onEdit={onEditTile}
                onToggleEnabled={(entry) =>
                  setEnabledMutation.mutate({
                    organizationId,
                    id: entry.id,
                    enabled: !entry.enabled,
                  })
                }
                onDelete={(entry) => setPendingDelete(entry)}
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

      <Dialog.Root
        open={pendingDelete !== null}
        onOpenChange={({ open }) => {
          if (!open) setPendingDelete(null);
        }}
        placement="center"
      >
        {pendingDelete && (
          <Dialog.Content bg="bg">
            <Dialog.CloseTrigger />
            <Dialog.Header>
              <Dialog.Title>Delete {pendingDelete.displayName}?</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Text fontSize="sm" color="fg.muted">
                This permanently removes the tile from the catalog and from
                every member&apos;s /me portal. It cannot be undone. To hide it
                without losing its configuration, use Disable instead.
              </Text>
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="outline" onClick={() => setPendingDelete(null)}>
                Cancel
              </Button>
              <Button
                colorPalette="red"
                loading={removeMutation.isPending}
                onClick={() =>
                  removeMutation.mutate({
                    organizationId,
                    id: pendingDelete.id,
                  })
                }
              >
                Delete tile
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        )}
      </Dialog.Root>
    </VStack>
  );
}

function SortableSection({
  items,
  departmentNameById,
  onDragEnd,
  onEdit,
  onToggleEnabled,
  onDelete,
  togglePendingId,
}: {
  items: AiToolEntry[];
  departmentNameById: Map<string, string>;
  onDragEnd: (event: DragEndEvent) => void;
  onEdit: (entry: AiToolEntry) => void;
  onToggleEnabled: (entry: AiToolEntry) => void;
  onDelete: (entry: AiToolEntry) => void;
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
              departmentNameById={departmentNameById}
              onEdit={() => onEdit(entry)}
              onToggleEnabled={() => onToggleEnabled(entry)}
              onDelete={() => onDelete(entry)}
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
  departmentNameById,
  onEdit,
  onToggleEnabled,
  onDelete,
  isPending,
}: {
  entry: AiToolEntry;
  departmentNameById: Map<string, string>;
  onEdit: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
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
      departmentNameById={departmentNameById}
      onEdit={onEdit}
      onToggleEnabled={onToggleEnabled}
      onDelete={onDelete}
      isPending={isPending}
      style={style}
      dragRef={setNodeRef}
      dragListeners={listeners}
      dragAttributes={attributes}
    />
  );
}

/**
 * Maps a tile's stored scope into ScopeChipPicker entries for the badge.
 * Org-wide → one ORGANIZATION chip; department-scoped → one DEPARTMENT
 * chip per department, names resolved from the departments list (falls
 * back to the bare id when a name is missing, e.g. an archived dept).
 */
function scopeChipsFor(
  entry: AiToolEntry,
  departmentNameById: Map<string, string>,
): { scopeType: "ORGANIZATION" | "DEPARTMENT"; scopeId: string; name?: string }[] {
  const departmentIds = entry.departmentIds ?? [];
  if (departmentIds.length === 0) {
    return [{ scopeType: "ORGANIZATION", scopeId: "org" }];
  }
  return departmentIds.map((id) => ({
    scopeType: "DEPARTMENT" as const,
    scopeId: id,
    name: departmentNameById.get(id) ?? id,
  }));
}

function CatalogRow({
  entry,
  departmentNameById,
  onEdit,
  onToggleEnabled,
  onDelete,
  isPending,
  style,
  dragRef,
  dragListeners,
  dragAttributes,
}: {
  entry: AiToolEntry;
  departmentNameById: Map<string, string>;
  onEdit: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  isPending: boolean;
  style?: React.CSSProperties;
  dragRef?: (element: HTMLElement | null) => void;
  dragListeners?: SyntheticListenerMap;
  dragAttributes?: DraggableAttributes;
}) {
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
      <ProviderScopeChips
        size="xs"
        scopes={scopeChipsFor(entry, departmentNameById)}
      />
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="ghost" size="xs" aria-label="Tile actions">
            <MoreVertical size={14} />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item
            value="edit"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          >
            <Pencil size={14} /> Edit
          </Menu.Item>
          <Menu.Item
            value="toggle"
            disabled={isPending}
            onClick={(event) => {
              event.stopPropagation();
              onToggleEnabled();
            }}
          >
            <Power size={14} /> {entry.enabled ? "Disable" : "Enable"}
          </Menu.Item>
          <Menu.Item
            value="delete"
            color="red"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 size={14} /> Delete
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </HStack>
  );
}
