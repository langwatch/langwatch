/**
 * Bulk upload (D1/D2/D4/D6-9 UI): a dedicated drawer to drop several files at
 * once. Each file is its own row with an inline collapsed column-type confirm;
 * "Upload all" prepares them in the background, independently. Shares the
 * single-file dropzone visuals (dotted grid + growing cloud + rainbow) so the
 * two flows look identical.
 */
import {
  Box,
  Button,
  Heading,
  HStack,
  Icon,
  Input,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  X,
} from "react-feather";
import { formatFileSize } from "react-papaparse";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { DatasetConfirmColumns } from "~/server/datasets/types";
import { api } from "~/utils/api";
import { ColumnTypeIcon } from "../../shared/ColumnTypeIcon";
import {
  COLUMN_TYPE_OPTIONS,
  ColumnTypeSelect,
} from "../../shared/ColumnTypeSelect";
import { Drawer } from "../../ui/drawer";
import {
  DROPZONE_DOTTED_STYLE,
  DropzonePrompt,
  dropzoneSurfaceProps,
  RAINBOW_TEXT_CSS,
} from "../datasetDropzoneStyles";
import { type BulkFile, useBulkUpload } from "./useBulkUpload";

// Visually hidden but kept in the tab order (not display:none) so the picker is
// reachable + operable by keyboard.
const SR_ONLY_INPUT: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/** Inline, compact column list for one file: rename, retype, and drag-reorder.
 *  Add/remove stays locked (the columns must still cover the file's headers 1:1),
 *  but order is free — each column carries an immutable `sourceHeader`, so the
 *  normalize job binds values by header, not array position (see
 *  `DatasetConfirmColumns`). The grip is the only drag affordance, so the name
 *  input + type select stay fully interactive. */
function BulkColumnFields({
  columnTypes,
  onChange,
}: {
  columnTypes: DatasetConfirmColumns;
  onChange: (next: DatasetConfirmColumns) => void;
}) {
  // Drag only starts past a small threshold, so a click into the name input
  // (or the type select) is never swallowed as a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  // The row currently being dragged — rendered in a DragOverlay so it floats
  // above (and is never clipped by) the drawer's scroll container.
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeColumn =
    columnTypes.find((c) => c.sourceHeader === activeId) ?? null;

  const setBySource = (
    sourceHeader: string,
    patch: Partial<DatasetConfirmColumns[number]>,
  ) =>
    onChange(
      columnTypes.map((c) =>
        c.sourceHeader === sourceHeader ? { ...c, ...patch } : c,
      ),
    );

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = columnTypes.findIndex((c) => c.sourceHeader === active.id);
    const to = columnTypes.findIndex((c) => c.sourceHeader === over.id);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(columnTypes, from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event: DragStartEvent) =>
        setActiveId(String(event.active.id))
      }
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext
        items={columnTypes.map((c) => c.sourceHeader)}
        strategy={verticalListSortingStrategy}
      >
        <VStack align="stretch" gap={2} width="full" paddingTop={2}>
          {columnTypes.map((col, index) => (
            <SortableColumnRow
              key={col.sourceHeader}
              col={col}
              index={index}
              onName={(name) => setBySource(col.sourceHeader, { name })}
              onType={(type) => setBySource(col.sourceHeader, { type })}
            />
          ))}
        </VStack>
      </SortableContext>
      {/* The lifted copy: position:fixed in a portal-like layer, so it escapes
          the drawer's overflow clipping and stacks above everything. */}
      <DragOverlay>
        {activeColumn ? <ColumnDragOverlayRow col={activeColumn} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

/** One draggable confirm-column row: grip handle + name input + type select.
 *  While being dragged it dims in place to a placeholder — the lifted copy is
 *  rendered by the DragOverlay (see {@link ColumnDragOverlayRow}). */
function SortableColumnRow({
  col,
  index,
  onName,
  onType,
}: {
  col: DatasetConfirmColumns[number];
  index: number;
  onName: (name: string) => void;
  onType: (type: DatasetConfirmColumns[number]["type"]) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: col.sourceHeader });

  return (
    <HStack
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      gap={2}
      width="full"
      paddingX={1}
    >
      <Box
        {...attributes}
        {...(listeners ?? {})}
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        color="fg.subtle"
        cursor="grab"
        _active={{ cursor: "grabbing" }}
        aria-label={`Drag to reorder ${col.name}`}
        title="Drag to reorder"
      >
        <Icon boxSize="16px">
          <GripVertical />
        </Icon>
      </Box>
      <Input
        size="sm"
        value={col.name}
        aria-label={`Column ${index + 1} name`}
        onChange={(e) => onName(e.target.value)}
      />
      <ColumnTypeSelect
        value={col.type}
        onChange={onType}
        aria-label={`Column ${index + 1} type`}
      />
    </HStack>
  );
}

/** The lifted, floating copy shown under the cursor while dragging a column.
 *  Presentational only (no inputs/listeners) — a gray-tokened, shadowed mirror
 *  of the row, with a static type chip so it reads identically. */
function ColumnDragOverlayRow({ col }: { col: DatasetConfirmColumns[number] }) {
  const typeLabel =
    COLUMN_TYPE_OPTIONS.find((o) => o.value === col.type)?.label ?? col.type;

  return (
    <HStack
      gap={2}
      width="full"
      paddingX={1}
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.emphasized"
      bg="bg.muted"
      shadow="lg"
      cursor="grabbing"
    >
      <Box
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        color="fg.subtle"
      >
        <Icon boxSize="16px">
          <GripVertical />
        </Icon>
      </Box>
      <Input
        size="sm"
        value={col.name}
        readOnly
        tabIndex={-1}
        pointerEvents="none"
        bg="bg"
      />
      <HStack
        gap={2}
        width="44"
        height="8"
        flexShrink={0}
        minW={0}
        paddingX={3}
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        bg="bg"
      >
        <ColumnTypeIcon type={col.type} size={14} />
        <Text truncate>{typeLabel}</Text>
      </HStack>
    </HStack>
  );
}

/** Click-to-edit dataset name (like the prompt variable-name field): a label
 *  that becomes a focused, text-selected input on click and commits on blur or
 *  Enter (Escape cancels). Editable only before the upload starts. */
function EditableName({
  value,
  editable,
  onCommit,
}: {
  value: string;
  editable: boolean;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  if (!editable) {
    return (
      <Text fontWeight="medium" truncate maxW="full">
        {value}
      </Text>
    );
  }
  if (editing) {
    const commit = () => {
      onCommit(draft);
      setEditing(false);
    };
    return (
      <Input
        size="sm"
        autoFocus
        value={draft}
        fontWeight="medium"
        aria-label="Dataset name"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <Button
      type="button"
      variant="plain"
      size="sm"
      height="auto"
      minW={0}
      maxW="full"
      paddingX={0}
      justifyContent="flex-start"
      title="Rename dataset"
      _hover={{ textDecoration: "underline dotted" }}
      onClick={() => setEditing(true)}
    >
      <Text as="span" fontWeight="medium" truncate maxW="full">
        {value}
      </Text>
    </Button>
  );
}

/** The right-aligned slot of a row: the confirm-types toggle while pending,
 *  otherwise an inline status tracker (preparing/uploading rainbow → ready). */
function RowTrailing({
  file,
  isOpen,
  onToggle,
}: {
  file: BulkFile;
  isOpen: boolean;
  onToggle: () => void;
}) {
  switch (file.status) {
    case "pending":
      if (!file.columnTypes || file.columnTypes.length === 0) return null;
      return (
        <HStack
          as="button"
          gap={1}
          fontSize="13px"
          color="blue.600"
          cursor="pointer"
          aria-label={`Confirm columns for ${file.name}`}
          onClick={onToggle}
        >
          <Text>{file.columnTypes.length} columns — confirm types</Text>
          {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </HStack>
      );
    case "queued":
      return (
        <Text fontSize="13px" color="fg.muted">
          Queued
        </Text>
      );
    case "uploading":
      return (
        <HStack gap={1.5}>
          <Spinner size="xs" color="blue.500" />
          <Text fontSize="13px" fontWeight="medium" css={RAINBOW_TEXT_CSS}>
            Uploading…
          </Text>
        </HStack>
      );
    case "processing":
      return (
        <HStack gap={1.5}>
          <Spinner size="xs" color="blue.500" />
          <Text fontSize="13px" fontWeight="medium" css={RAINBOW_TEXT_CSS}>
            Preparing…
          </Text>
        </HStack>
      );
    case "ready":
      return (
        <HStack gap={1} color="green.600" fontSize="13px">
          <CheckCircle size={14} />
          <Text>Ready</Text>
        </HStack>
      );
    case "failed":
    case "rejected":
      return (
        <Text fontSize="13px" color="red.500">
          {file.rejectedReason === "unsupported"
            ? "Unsupported file"
            : file.rejectedReason === "too-large"
              ? "Too large"
              : (file.error ?? "Failed")}
        </Text>
      );
    case "cancelled":
      return (
        <Text fontSize="13px" color="fg.muted">
          Cancelled
        </Text>
      );
    default:
      return null;
  }
}

function BulkFileRow({
  file,
  projectId,
  onRemove,
  onCancel,
  onRetry,
  onColumns,
  onName,
  onReady,
  onFailed,
}: {
  file: BulkFile;
  projectId: string;
  onRemove: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onColumns: (next: DatasetConfirmColumns) => void;
  onName: (next: string) => void;
  onReady: () => void;
  onFailed: (error?: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // Only an in-flight PUT is cancellable; a `processing` row is already
  // finalized (its dataset exists) so it offers neither cancel nor remove.
  const canCancel = file.status === "uploading";
  const isProcessing = file.status === "processing";
  const canConfirm =
    file.status === "pending" &&
    !!file.columnTypes &&
    file.columnTypes.length > 0;

  // Poll the dataset status inline once finalized (no nested container). The
  // server normalizes off-thread; the row reports ready/failed in place.
  const isPolling = file.status === "processing" && !!file.datasetId;
  const statusQuery = api.dataset.getById.useQuery(
    { projectId, datasetId: file.datasetId ?? "" },
    {
      enabled: isPolling,
      refetchOnWindowFocus: false,
      refetchInterval: (data: { status?: string } | null | undefined) =>
        data?.status === "processing" ? 3000 : false,
    },
  );
  const polledStatus = statusQuery.data?.status;
  useEffect(() => {
    if (!isPolling) return;
    if (polledStatus === "ready") onReady();
    else if (polledStatus === "failed") {
      onFailed(
        (statusQuery.data as { statusError?: string } | undefined)
          ?.statusError ?? undefined,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPolling, polledStatus]);

  return (
    <VStack
      align="stretch"
      gap={0}
      padding={3}
      borderWidth="1px"
      borderRadius="lg"
      borderColor={
        file.status === "failed" || file.status === "rejected"
          ? "red.300"
          : "border"
      }
      bg="bg"
    >
      <HStack gap={3} width="full" align="center">
        <VStack align="start" gap={0} flex={1} minW={0}>
          <EditableName
            value={file.name}
            editable={file.status === "pending"}
            onCommit={onName}
          />
          <Text fontSize="xs" color="fg.muted">
            {formatFileSize(file.file.size)}
          </Text>
        </VStack>
        <Spacer />
        <RowTrailing
          file={file}
          isOpen={isOpen}
          onToggle={() => setIsOpen((o) => !o)}
        />
        {file.status === "failed" && (
          <Button size="xs" variant="outline" onClick={onRetry}>
            <RefreshCw size={12} /> Retry
          </Button>
        )}
        {canCancel ? (
          <Box
            as="button"
            aria-label="Cancel upload"
            color="fg.muted"
            display="flex"
            _hover={{ color: "red.500" }}
            onClick={onCancel}
          >
            <X size={16} />
          </Box>
        ) : isProcessing ? null : (
          <Box
            as="button"
            aria-label="Remove file"
            color="fg.muted"
            display="flex"
            _hover={{ color: "red.500" }}
            onClick={onRemove}
          >
            <X size={16} />
          </Box>
        )}
      </HStack>

      {/* Smoothly expand/collapse the confirm columns. AnimatePresence keeps the
          content mounted through the exit animation, then unmounts it — so a
          collapsed row holds no focusable inputs (a11y) and stays out of the DOM. */}
      <AnimatePresence initial={false}>
        {isOpen && canConfirm && file.columnTypes && (
          <motion.div
            key="confirm-columns"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            style={{ overflow: "hidden", width: "100%" }}
          >
            <BulkColumnFields
              columnTypes={file.columnTypes}
              onChange={onColumns}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </VStack>
  );
}

export function BulkUploadDrawer({
  open,
  onClose,
  onUploaded,
  onCreateFromScratch,
}: {
  open: boolean;
  onClose: () => void;
  /** Called as files reach `ready` so the host can refresh the datasets list. */
  onUploaded?: () => void;
  /** Escape hatch out of the upload flow: create an empty dataset by hand
   *  instead. Omit to hide the "Skip" affordance. */
  onCreateFromScratch?: () => void;
}) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const bulk = useBulkUpload(projectId);
  const [zoneHover, setZoneHover] = useState(false);

  const onDropFiles = (fileList: FileList | null) => {
    if (fileList && fileList.length > 0) {
      void bulk.addFiles(Array.from(fileList));
    }
  };

  return (
    <Drawer.Root
      open={open}
      onOpenChange={({ open: o }) => !o && onClose()}
      size="xl"
    >
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <Heading>Upload datasets</Heading>
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4} width="full">
            <Box
              as="label"
              {...dropzoneSurfaceProps(zoneHover)}
              style={DROPZONE_DOTTED_STYLE}
              display="block"
              onDragOver={(e: React.DragEvent) => {
                e.preventDefault();
                setZoneHover(true);
              }}
              onDragLeave={(e: React.DragEvent) => {
                e.preventDefault();
                setZoneHover(false);
              }}
              onDrop={(e: React.DragEvent) => {
                e.preventDefault();
                setZoneHover(false);
                onDropFiles(e.dataTransfer?.files ?? null);
              }}
            >
              <input
                type="file"
                multiple
                accept=".csv,.json,.jsonl"
                aria-label="Add files for bulk upload"
                style={SR_ONLY_INPUT}
                onChange={(e) => {
                  onDropFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <DropzonePrompt multiple />
            </Box>

            {bulk.counts.total > 0 && (
              <HStack
                fontSize="13px"
                color="fg.muted"
                gap={3}
                data-testid="bulk-summary"
              >
                <Text>{bulk.counts.total} files</Text>
                {bulk.counts.ready > 0 && (
                  <Text color="green.600">{bulk.counts.ready} ready</Text>
                )}
                {bulk.counts.preparing > 0 && (
                  <Text color="blue.500">
                    {bulk.counts.preparing} preparing
                  </Text>
                )}
                {bulk.counts.queued > 0 && (
                  <Text>{bulk.counts.queued} queued</Text>
                )}
                {bulk.counts.failed > 0 && (
                  <HStack gap={1} color="red.500">
                    <AlertTriangle size={13} />
                    <Text>{bulk.counts.failed} failed</Text>
                  </HStack>
                )}
              </HStack>
            )}

            <VStack align="stretch" gap={2} width="full">
              {bulk.files.map((file) => (
                <BulkFileRow
                  key={file.id}
                  file={file}
                  projectId={projectId ?? ""}
                  onRemove={() => bulk.removeFile(file.id)}
                  onCancel={() => bulk.cancelFile(file.id)}
                  onRetry={() => void bulk.retryFile(file.id)}
                  onColumns={(next) => bulk.setColumnTypes(file.id, next)}
                  onName={(next) => bulk.setName({ id: file.id, name: next })}
                  onReady={() => {
                    bulk.markReady(file.id);
                    onUploaded?.();
                  }}
                  onFailed={(error) => bulk.markFailed(file.id, error)}
                />
              ))}
            </VStack>

            <HStack width="full">
              {onCreateFromScratch && (
                <Button
                  variant="plain"
                  colorPalette="gray"
                  fontWeight="normal"
                  color="blue.700"
                  paddingX={0}
                  onClick={onCreateFromScratch}
                >
                  Skip, create empty dataset
                </Button>
              )}
              <Spacer />
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button
                colorPalette="blue"
                disabled={!bulk.hasUploadable || !projectId}
                onClick={() => bulk.start()}
              >
                Upload all
              </Button>
            </HStack>
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
