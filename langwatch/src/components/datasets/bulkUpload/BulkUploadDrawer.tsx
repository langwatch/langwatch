/**
 * Bulk upload (D1/D2/D4/D6-9 UI): a dedicated drawer to drop several files at
 * once. Each file is its own row with an inline collapsed column-type confirm;
 * "Upload all" prepares them in the background, independently. Reuses the
 * single-flow's `DatasetUploadProcessing` poller for each row's processing tail.
 */
import {
  Box,
  Button,
  Collapsible,
  Heading,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  RefreshCw,
  X,
  XCircle,
} from "react-feather";
import { formatFileSize } from "react-papaparse";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { DatasetColumns } from "~/server/datasets/types";
import { Drawer } from "../../ui/drawer";
import { DatasetUploadProcessing } from "../UploadCSVDrawer";
import { type BulkFile, useBulkUpload } from "./useBulkUpload";

const COLUMN_TYPE_OPTIONS = [
  "string",
  "number",
  "boolean",
  "date",
  "list",
  "json",
  "image",
] as const;

/** Inline, compact column-type list for one file: rename + retype only (the
 *  confirmed columns must stay positionally 1:1 with the file's headers — no
 *  add/remove). */
function BulkColumnFields({
  columnTypes,
  onChange,
}: {
  columnTypes: DatasetColumns;
  onChange: (next: DatasetColumns) => void;
}) {
  const setAt = (index: number, patch: Partial<DatasetColumns[number]>) =>
    onChange(columnTypes.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  return (
    <VStack align="stretch" gap={2} width="full">
      {columnTypes.map((col, index) => (
        <HStack key={index} gap={2} width="full">
          <Input
            size="sm"
            value={col.name}
            aria-label={`Column ${index + 1} name`}
            onChange={(e) => setAt(index, { name: e.target.value })}
          />
          <NativeSelect.Root size="sm" width="40">
            <NativeSelect.Field
              value={col.type}
              aria-label={`Column ${index + 1} type`}
              onChange={(e) =>
                setAt(index, {
                  type: e.target.value as DatasetColumns[number]["type"],
                })
              }
            >
              {COLUMN_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t === "image" ? "image (URL)" : t}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </HStack>
      ))}
    </VStack>
  );
}

function StatusChip({ file }: { file: BulkFile }) {
  switch (file.status) {
    case "ready":
      return (
        <HStack gap={1} color="green.600" fontSize="13px">
          <CheckCircle size={14} /> <Text>Ready</Text>
        </HStack>
      );
    case "failed":
    case "rejected":
      return (
        <HStack gap={1} color="red.500" fontSize="13px">
          <XCircle size={14} />
          <Text>
            {file.rejectedReason === "unsupported"
              ? "Unsupported file"
              : file.rejectedReason === "too-large"
                ? "Too large"
                : (file.error ?? "Failed")}
          </Text>
        </HStack>
      );
    case "queued":
      return (
        <Text fontSize="13px" color="fg.muted">
          Queued
        </Text>
      );
    case "uploading":
    case "processing":
      return (
        <HStack gap={1} color="blue.500" fontSize="13px">
          <Spinner size="xs" /> <Text>Preparing…</Text>
        </HStack>
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
  onReady,
}: {
  file: BulkFile;
  projectId: string;
  onRemove: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onColumns: (next: DatasetColumns) => void;
  onReady: () => void;
}) {
  const canConfirm =
    file.status === "pending" &&
    file.columnTypes &&
    file.columnTypes.length > 0;
  const isActive = file.status === "uploading" || file.status === "processing";

  return (
    <VStack
      align="stretch"
      gap={2}
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
      <HStack gap={3} width="full">
        <VStack align="start" gap={0} flex={1} minW={0}>
          <Text fontWeight="medium" truncate maxW="full">
            {file.name}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {formatFileSize(file.file.size)}
          </Text>
        </VStack>
        <StatusChip file={file} />
        {file.status === "failed" && (
          <Button size="xs" variant="outline" onClick={onRetry}>
            <RefreshCw size={12} /> Retry
          </Button>
        )}
        {isActive ? (
          <Box
            as="button"
            aria-label="Cancel upload"
            color="fg.muted"
            _hover={{ color: "red.500" }}
            onClick={onCancel}
          >
            <X size={16} />
          </Box>
        ) : (
          <Box
            as="button"
            aria-label="Remove file"
            color="fg.muted"
            _hover={{ color: "red.500" }}
            onClick={onRemove}
          >
            <X size={16} />
          </Box>
        )}
      </HStack>

      {canConfirm && file.columnTypes && (
        <Collapsible.Root>
          <Collapsible.Trigger
            asChild
            aria-label={`Confirm columns for ${file.name}`}
          >
            <HStack
              as="button"
              gap={1}
              fontSize="13px"
              color="blue.600"
              cursor="pointer"
            >
              <ChevronDown size={14} />
              <Text>{file.columnTypes.length} columns — confirm types</Text>
            </HStack>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <Box paddingTop={2}>
              <BulkColumnFields
                columnTypes={file.columnTypes}
                onChange={onColumns}
              />
            </Box>
          </Collapsible.Content>
        </Collapsible.Root>
      )}

      {file.status === "processing" && file.datasetId && (
        <DatasetUploadProcessing
          projectId={projectId}
          datasetId={file.datasetId}
          onReady={onReady}
          onViewDataset={onReady}
        />
      )}
    </VStack>
  );
}

export function BulkUploadDrawer({
  open,
  onClose,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  /** Called as files reach `ready` so the host can refresh the datasets list. */
  onUploaded?: () => void;
}) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const bulk = useBulkUpload(projectId);

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
          <Heading>Bulk upload</Heading>
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4} width="full">
            <Box
              as="label"
              borderWidth="2px"
              borderStyle="dashed"
              borderColor="border"
              borderRadius="xl"
              padding={8}
              textAlign="center"
              cursor="pointer"
              _hover={{ borderColor: "blue.300", bg: "blue.500/5" }}
              onDragOver={(e: React.DragEvent) => e.preventDefault()}
              onDrop={(e: React.DragEvent) => {
                e.preventDefault();
                onDropFiles(e.dataTransfer?.files ?? null);
              }}
            >
              <input
                type="file"
                multiple
                accept=".csv,.json,.jsonl"
                aria-label="Add files for bulk upload"
                // Visually hidden but kept in the tab order (not display:none) so
                // the picker is reachable + operable by keyboard.
                style={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: "hidden",
                  clip: "rect(0 0 0 0)",
                  whiteSpace: "nowrap",
                  border: 0,
                }}
                onChange={(e) => {
                  onDropFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <Text color="fg" fontSize="md">
                Drag and drop files, or{" "}
                <Text as="span" color="blue.500" fontWeight="medium">
                  click to browse
                </Text>
              </Text>
              <Text fontSize="xs" color="fg.muted">
                Supported files: CSV, JSON, or JSONL — one dataset per file
              </Text>
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
                  onReady={() => {
                    bulk.markReady(file.id);
                    onUploaded?.();
                  }}
                />
              ))}
            </VStack>

            <HStack width="full">
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
