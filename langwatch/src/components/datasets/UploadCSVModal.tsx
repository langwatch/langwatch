import {
  Box,
  Button,
  HStack,
  Spacer,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import {
  formatFileSize,
  jsonToCSV as papaparseJsonToCSV,
  readString as papaparseReadString,
  useCSVReader,
  usePapaParse,
} from "react-papaparse";
import type { InMemoryDataset } from "~/components/datasets/editor/DatasetEditorTable";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { createLogger } from "~/utils/logger";
import { Dialog } from "../../components/ui/dialog";
import type {
  DatasetColumns,
  DatasetRecordEntry,
} from "../../server/datasets/types";
import { MAX_FILE_SIZE_BYTES } from "../../server/datasets/upload-utils";
import {
  type AddDatasetDrawerProps,
  AddOrEditDatasetDrawer,
} from "../AddOrEditDatasetDrawer";
import { toaster } from "../ui/toaster";
import {
  abortPendingUpload,
  DirectUploadUnavailableError,
  finalizeDirectUpload,
  PresignedUploadFailedError,
  putFileToPresignedUrl,
  requestDirectUpload,
} from "./services/directUpload";
import { getSafeColumnName } from "./utils/reservedColumns";
export const MAX_ROWS_LIMIT = 10_000;

const logger = createLogger("UploadCSVModal");

export function UploadCSVModal({
  isOpen: isOpen_,
  onClose: onClose_,
  onSuccess,
  onCreateFromScratch,
  enableDirectUpload = true,
}: {
  isOpen?: boolean;
  onClose?: () => void;
  onSuccess: AddDatasetDrawerProps["onSuccess"];
  onCreateFromScratch?: () => void;
  /**
   * When true (default), a successful upload streams the raw file directly to
   * object storage and navigates to the dataset page while it is prepared.
   * Hosts that need the dataset's columns synchronously (e.g. the workflow
   * dataset picker) pass false to keep the in-browser-parse drawer flow.
   */
  enableDirectUpload?: boolean;
}) {
  const { closeDrawer } = useDrawer();
  const onClose = onClose_ ?? closeDrawer;
  const isOpen = isOpen_ ?? true;

  const addDatasetDrawer = useDisclosure();
  const [localIsOpen, setLocalIsOpen] = useState(isOpen);
  const [uploadedDataset, setUploadedDataset] = useState<
    InMemoryDataset | undefined
  >(undefined);

  const uploadCSVData = () => {
    setLocalIsOpen(false);
    addDatasetDrawer.onOpen();
  };

  useEffect(() => {
    setLocalIsOpen(isOpen);
    if (!isOpen) {
      setUploadedDataset(undefined);
      addDatasetDrawer.onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <>
      <Dialog.Root
        open={localIsOpen}
        onOpenChange={({ open }) => !open && onClose()}
        closeOnInteractOutside={false}
      >
        <Dialog.Content bg="bg">
          <Dialog.Header>
            <Dialog.Title>Upload CSV</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body>
            <UploadCSVForm
              setUploadedDataset={setUploadedDataset}
              uploadedDataset={uploadedDataset}
              uploadCSVData={uploadCSVData}
              onCreateFromScratch={onCreateFromScratch}
              enableDirectUpload={enableDirectUpload}
              onClose={onClose}
            />
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
      <AddOrEditDatasetDrawer
        datasetToSave={uploadedDataset}
        open={addDatasetDrawer.open}
        onClose={() => {
          addDatasetDrawer.onClose();
          onClose();
        }}
        onSuccess={(params) => {
          onSuccess(params);
          onClose();
        }}
      />
    </>
  );
}

export function InlineUploadCSVForm({
  onSuccess,
}: {
  onSuccess: AddDatasetDrawerProps["onSuccess"];
}) {
  const addDatasetDrawer = useDisclosure();
  const [uploadedDataset, setUploadedDataset] = useState<
    InMemoryDataset | undefined
  >(undefined);

  return (
    <>
      <UploadCSVForm
        setUploadedDataset={setUploadedDataset}
        uploadedDataset={uploadedDataset}
        uploadCSVData={addDatasetDrawer.onOpen}
        disabled={addDatasetDrawer.open}
      />
      <AddOrEditDatasetDrawer
        datasetToSave={uploadedDataset}
        open={addDatasetDrawer.open}
        onClose={() => {
          addDatasetDrawer.onClose();
        }}
        onSuccess={(params) => {
          onSuccess(params);
        }}
      />
    </>
  );
}

export function UploadCSVForm({
  setUploadedDataset,
  uploadedDataset,
  onCreateFromScratch,
  uploadCSVData,
  disabled,
  enableDirectUpload = false,
  onClose,
}: {
  setUploadedDataset: (dataset: InMemoryDataset | undefined) => void;
  uploadedDataset: InMemoryDataset | undefined;
  onCreateFromScratch?: () => void;
  uploadCSVData: () => void;
  disabled?: boolean;
  /** When true, "Upload" streams the raw file to storage and navigates to the
   *  dataset page; falls back to the parse-and-drawer flow if storage is off. */
  enableDirectUpload?: boolean;
  onClose?: () => void;
}) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const trpcUtils = api.useContext();
  const router = useRouter();

  // The raw file from the dropzone. The direct-upload path streams this as-is
  // (no in-browser parse, so it never OOMs on big files and the columns are
  // derived server-side by normalize). The parsed `uploadedDataset` is only
  // used by the fallback (no-storage) flow.
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const getValidName = async (proposedName: string): Promise<string> => {
    if (!projectId) return proposedName;
    const validName = await trpcUtils.dataset.findNextName.fetch({
      projectId: projectId,
      proposedName: proposedName,
    });
    return validName;
  };

  const proposeValidName = async (filename: string): Promise<string> => {
    let validName = "New Dataset";
    try {
      // Propose new name based on the file name.
      validName = filename.split(".")[0] || validName;
      // Try to get a valid name from the DB, in case it's already taken.
      validName = await getValidName(validName);
    } catch (error) {
      logger.error({ error }, "Failed to get valid name");
    }
    return validName;
  };

  const handleUploadAccepted = async (results: {
    data: string[][];
    acceptedFile: File;
  }) => {
    const { data, acceptedFile } = results;
    setRawFile(acceptedFile);
    setUploadError(null);

    const validName = await proposeValidName(acceptedFile.name);
    setUploadedDataset(buildDatasetFromRows(data, validName));
  };

  /**
   * Direct-to-storage path (ADR-032 D4): request a presigned PUT, stream the
   * raw file, finalize, then navigate to the dataset page where the processing
   * banner takes over. The raw file is captured WITHOUT an in-browser parse
   * (see `onRawFile` below), so a multi-GB file never OOMs the tab on the happy
   * path. On no-storage installs `requestDirectUpload` throws
   * `DirectUploadUnavailableError`; only THEN do we lazily parse the captured
   * file and fall back to the parse-and-drawer flow, so small/self-hosted
   * setups are unaffected.
   */
  const handleUpload = async () => {
    if (!enableDirectUpload || !rawFile || !projectId || !project) {
      uploadCSVData();
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    // Track the pending dataset so a presigned-PUT failure can clean up the
    // orphaned `uploading` row before falling back.
    let pendingDatasetId: string | undefined;
    try {
      const name =
        uploadedDataset?.name ?? (await proposeValidName(rawFile.name));
      const { datasetId, uploadUrl } = await requestDirectUpload({
        projectId,
        name,
        filename: rawFile.name,
      });
      pendingDatasetId = datasetId;
      await putFileToPresignedUrl(uploadUrl, rawFile);
      await finalizeDirectUpload({ projectId, datasetId });

      toaster.create({
        title: "Preparing your dataset",
        type: "success",
        meta: { closable: true },
      });
      onClose?.();
      void router.push(`/${project.slug}/datasets/${datasetId}`);
    } catch (error) {
      // Both "no browser-reachable storage" (backend never minted a presign) and
      // "presigned PUT failed" (CORS/network/non-ok) mean: fall back to the
      // backend upload path. The fallback is size-guarded, so a small file +
      // missing CORS still works, and a large file + missing CORS shows the
      // clear "large uploads require object storage" error. Either way, no dead
      // end.
      if (
        error instanceof DirectUploadUnavailableError ||
        error instanceof PresignedUploadFailedError
      ) {
        // A presigned-PUT failure already created the `uploading` row; reap it so
        // a CORS-failed attempt doesn't leave a stuck dataset behind (the
        // fallback creates a fresh one). Best-effort — never block the fallback.
        if (error instanceof PresignedUploadFailedError && pendingDatasetId) {
          try {
            await abortPendingUpload({
              projectId,
              datasetId: pendingDatasetId,
            });
          } catch (cleanupError) {
            logger.error(
              { error: cleanupError },
              "Failed to clean up pending upload after presigned PUT failure",
            );
          }
        }
        // Parse the already-captured file NOW (the first and only in-browser
        // parse on this path) and hand off to the existing parse-and-drawer flow.
        await runFallbackParseAndDrawer(rawFile);
        return;
      }
      logger.error({ error }, "Direct dataset upload failed");
      setUploadError(
        error instanceof Error
          ? error.message
          : "Something went wrong uploading your file. Please try again.",
      );
      setIsUploading(false);
    }
  };

  /**
   * 409-fallback only: lazily parse the raw file we captured up front, populate
   * `uploadedDataset`, and open the parse-and-drawer flow. This is the single
   * point where the direct path ever parses in-browser.
   *
   * Guarded on the legacy 25 MB limit (`MAX_FILE_SIZE_BYTES`): without object
   * storage this path parses the whole file in the tab, so a multi-GB file would
   * OOM the browser (the exact failure direct upload avoids). Over the limit we
   * abort with a clear message instead of parsing.
   */
  const runFallbackParseAndDrawer = async (file: File) => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError(
        "This file is too large to upload on this deployment. Large uploads require object storage.",
      );
      setIsUploading(false);
      return;
    }
    try {
      const rows = await parseFileToRows(file);
      const validName = await proposeValidName(file.name);
      setUploadedDataset(buildDatasetFromRows(rows, validName));
      setIsUploading(false);
      uploadCSVData();
    } catch (error) {
      logger.error({ error }, "Fallback parse of dataset file failed");
      setUploadError(
        error instanceof Error
          ? error.message
          : "Something went wrong reading your file. Please try again.",
      );
      setIsUploading(false);
    }
  };

  // The direct path streams the raw file, so it is not bound by the in-browser
  // row limit. The limit only constrains the fallback (parse-and-drawer) flow.
  const overRowLimitForFallback =
    !enableDirectUpload &&
    !!uploadedDataset &&
    uploadedDataset.datasetRecords.length > MAX_ROWS_LIMIT;

  const canUpload = enableDirectUpload
    ? !!rawFile
    : !!uploadedDataset &&
      uploadedDataset.datasetRecords.length > 0 &&
      !overRowLimitForFallback;

  return (
    <VStack width="full" align="start" gap={4}>
      <CSVReaderComponent
        // Direct path: capture only the raw File (no parse). Fallback/picker
        // path: parse immediately for synchronous columns/records.
        parse={!enableDirectUpload}
        onUploadAccepted={handleUploadAccepted}
        onRawFile={(file) => {
          setRawFile(file);
          setUploadError(null);
        }}
        onUploadRemoved={() => {
          setUploadedDataset(undefined);
          setRawFile(null);
          setUploadError(null);
        }}
      />
      <HStack width="full" align="end">
        {overRowLimitForFallback && (
          <Text color="red.500" paddingTop={4}>
            Sorry, the max number of rows accepted for datasets is currently{" "}
            {MAX_ROWS_LIMIT} rows. Please reduce the number of rows or contact
            support.
          </Text>
        )}
        {uploadError && (
          <Text color="red.500" paddingTop={4} data-testid="upload-error">
            {uploadError}
          </Text>
        )}

        {onCreateFromScratch && (
          <Button
            variant="plain"
            colorPalette="gray"
            fontWeight="normal"
            color="blue.700"
            onClick={onCreateFromScratch}
            disabled={isUploading}
          >
            Skip, create empty dataset
          </Button>
        )}
        <Spacer />
        <Button
          colorPalette="blue"
          loading={isUploading}
          disabled={!!disabled || isUploading || !canUpload}
          onClick={() => void handleUpload()}
        >
          Upload
        </Button>
      </HStack>
    </VStack>
  );
}

export function CSVReaderComponent({
  onUploadAccepted,
  onUploadRemoved,
  onRawFile,
  parse = true,
  children,
}: {
  onUploadAccepted: (results: {
    data: string[][];
    acceptedFile: File;
  }) => void | Promise<void>;
  onUploadRemoved?: () => void;
  /**
   * Raw-file callback for the no-parse path: receives the dropped `File` (or
   * `null` on removal) WITHOUT any in-browser parse. Required when `parse` is
   * false; ignored otherwise.
   */
  onRawFile?: (file: File | null) => void;
  /**
   * When false, the dropzone captures only the raw `File` and never runs
   * PapaParse / `readString` — so a multi-GB file does not OOM the browser
   * before the direct upload (ADR-032 D4). The default (true) keeps the
   * parse-and-emit behaviour `AddRowsFromCSVModal` and the no-storage fallback
   * rely on for synchronous columns/records.
   */
  parse?: boolean;
  children?: (hasAcceptedFile: boolean) => React.ReactNode;
}) {
  if (!parse) {
    return (
      <RawFileDropzone onRawFile={onRawFile} onUploadRemoved={onUploadRemoved}>
        {children}
      </RawFileDropzone>
    );
  }

  return (
    <ParsingCSVReader
      onUploadAccepted={onUploadAccepted}
      onUploadRemoved={onUploadRemoved}
    >
      {children}
    </ParsingCSVReader>
  );
}

/**
 * Parse-and-emit dropzone: runs PapaParse (and a JSON/JSONL→CSV pre-parse) on
 * the dropped file so callers get `{ data, acceptedFile }` synchronously. Used
 * by `AddRowsFromCSVModal` and the no-storage fallback, which need columns and
 * records up front. NOT used on the direct-upload happy path (see
 * `RawFileDropzone`) — this parse is what OOMs the browser on big files.
 */
function ParsingCSVReader({
  onUploadAccepted,
  onUploadRemoved,
  children,
}: {
  onUploadAccepted: (results: {
    data: string[][];
    acceptedFile: File;
  }) => void | Promise<void>;
  onUploadRemoved?: () => void;
  children?: (hasAcceptedFile: boolean) => React.ReactNode;
}) {
  const { CSVReader } = useCSVReader();
  const [zoneHover, setZoneHover] = useState(false);
  const [acceptedFile, setAcceptedFile] = useState<File | null>(null);
  const [results, setResults] = useState<{ data: string[][] } | null>(null);
  const { readString } = usePapaParse();

  useEffect(() => {
    if (acceptedFile && results) {
      void onUploadAccepted({ ...results, acceptedFile });
    } else if (!acceptedFile) {
      onUploadRemoved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptedFile, results]);

  return (
    <CSVReader
      accept=".csv,.json,.jsonl"
      config={{
        // Every well-formed CSV ends with a newline; without this the final
        // line parses as [""] and uploads as an empty record
        skipEmptyLines: "greedy",
      }}
      onUploadAccepted={async (results: { data: string[][] }, file: File) => {
        if (file.name.endsWith(".jsonl") || file.name.endsWith(".json")) {
          try {
            readString(jsonFileTextToCSV(await file.text()), {
              skipEmptyLines: "greedy",
              complete: (results) => {
                setResults({ data: results.data as string[][] });
              },
            });
          } catch (error) {
            console.error("error", error);
            toaster.create({
              title: "Error",
              description: "Failed to parse JSON file",
              type: "error",
              meta: {
                closable: true,
              },
            });
          }
        } else {
          setResults(results);
          setZoneHover(false);
        }
      }}
      onDragOver={(event: DragEvent) => {
        event.preventDefault();
        setZoneHover(true);
      }}
      onDragLeave={(event: DragEvent) => {
        event.preventDefault();
        setZoneHover(false);
      }}
    >
      {({
        getRootProps,
        acceptedFile,
        ProgressBar,
        getRemoveFileProps,
        Remove,
      }: {
        getRootProps: () => Record<string, unknown>;
        acceptedFile: File | null;
        ProgressBar: React.ComponentType;
        getRemoveFileProps: () => Record<string, unknown>;
        Remove: React.ComponentType;
      }) => {
        return (
          <>
            <CSVReaderBox
              acceptedFile={acceptedFile}
              setAcceptedFile={setAcceptedFile}
              zoneHover={zoneHover}
              getRootProps={getRootProps}
              getRemoveFileProps={getRemoveFileProps}
              Remove={Remove}
              ProgressBar={ProgressBar}
            />
            {children ? children(acceptedFile !== null) : null}{" "}
            {/* Pass boolean indicating if file is accepted to render prop */}
          </>
        );
      }}
    </CSVReader>
  );
}

/**
 * Build an in-memory dataset from already-parsed CSV rows (header + body),
 * renaming reserved/colliding columns and toasting the rename. Shared by the
 * immediate-parse path and the no-storage fallback so both produce identical
 * datasets.
 */
function buildDatasetFromRows(data: string[][], name: string): InMemoryDataset {
  const originalColumnNames = data[0] ?? [];
  const existingNames = new Set<string>();
  const columns: DatasetColumns = originalColumnNames.map((col: string) => {
    const safeColumnName = getSafeColumnName(col, existingNames);

    // Add the safe name to the set to prevent future collisions
    existingNames.add(safeColumnName);

    // If this column name was changed, show a warning to the user
    if (safeColumnName !== col) {
      toaster.create({
        title: "Column Renamed",
        description: `Column "${col}" is reserved or conflicts with existing columns and has been renamed to "${safeColumnName}"`,
        type: "warning",
        meta: {
          closable: true,
        },
      });
    }

    return {
      name: safeColumnName,
      type: "string" as const,
    };
  });

  const now = new Date().getTime();
  const records: DatasetRecordEntry[] = data
    .slice(1)
    .map((row: string[], index: number) => ({
      id: `${now}-${index}`,
      ...Object.fromEntries(row.map((col, i) => [columns[i]?.name, col])),
    }));

  return { datasetRecords: records, columnTypes: columns, name };
}

/**
 * Parse a raw CSV/JSON/JSONL file into header+body rows. Used ONLY by the
 * no-storage fallback: the direct path captures the file unparsed and reaches
 * here just when storage is unavailable. Mirrors the JSON/JSONL handling in
 * `ParsingCSVReader` so both paths read the same file the same way.
 */
async function parseFileToRows(file: File): Promise<string[][]> {
  const isJson = file.name.endsWith(".jsonl") || file.name.endsWith(".json");
  const csvString = isJson
    ? jsonFileTextToCSV(await file.text())
    : await file.text();

  return new Promise<string[][]>((resolve, reject) => {
    papaparseReadString<string[]>(csvString, {
      skipEmptyLines: "greedy",
      complete: (results) => resolve(results.data),
      error: (error: Error) => reject(error),
    });
  });
}

/** Convert raw JSON or JSONL text into CSV text (header + rows). */
function jsonFileTextToCSV(contents: string): string {
  let jsonContents: object[];
  try {
    jsonContents = JSON.parse(contents);
  } catch {
    // Not valid JSON; treat as JSONL (one object per line).
    jsonContents = JSON.parse(
      "[" +
        contents
          .trim()
          .split("\n")
          .filter((line) => line.trim() !== "")
          .join(", ") +
        "]",
    );
  }
  return jsonToCSV(jsonContents);
}

function jsonToCSV(jsonContents: object[]): string {
  const stringifiedNestedValues = jsonContents.map((item) => {
    return Object.fromEntries(
      Object.entries(item).map(([key, value]) => {
        if (value && typeof value === "object") {
          return [key, JSON.stringify(value)];
        }
        return [key, value];
      }),
    );
  });
  const columns = new Set(
    stringifiedNestedValues.flatMap((item) => Object.keys(item)),
  );

  return papaparseJsonToCSV(stringifiedNestedValues, {
    columns: Array.from(columns),
  });
}

function CSVReaderBox({
  acceptedFile,
  setAcceptedFile,
  zoneHover,
  getRootProps,
  getRemoveFileProps,
  Remove,
  ProgressBar,
}: {
  acceptedFile: File | null;
  setAcceptedFile: (file: File | null) => void;
  zoneHover: boolean;
  getRootProps: () => Record<string, unknown>;
  getRemoveFileProps: () => Record<string, unknown>;
  Remove: React.ComponentType;
  ProgressBar: React.ComponentType;
}) {
  useEffect(() => {
    setAcceptedFile(acceptedFile);
  }, [acceptedFile, setAcceptedFile]);

  return (
    <Box
      {...getRootProps()}
      borderRadius={"lg"}
      borderWidth={2}
      borderColor={zoneHover ? "border.emphasized" : "border"}
      borderStyle="dashed"
      padding={10}
      textAlign="center"
      cursor="pointer"
      width="full"
    >
      {acceptedFile ? (
        <>
          <Box
            bg="bg.muted"
            padding={4}
            borderRadius={"lg"}
            position="relative"
          >
            <VStack>
              <Text>{formatFileSize(acceptedFile.size)}</Text>
              <Text>{acceptedFile.name}</Text>
            </VStack>
            <ProgressBar />

            <Box
              position="absolute"
              right={-1}
              top={-1}
              {...getRemoveFileProps()}
            >
              <Remove />
            </Box>
          </Box>
        </>
      ) : (
        <Text>Drop CSV or JSONL file or click here to upload</Text>
      )}
    </Box>
  );
}

/**
 * No-parse dropzone for the direct-upload happy path (ADR-032 D4). Captures the
 * raw `File` via a native file input + drag handlers and never runs PapaParse —
 * `react-papaparse`'s `CSVReader` parses the whole file in-browser before its
 * `onUploadAccepted` fires, which OOMs the browser on a multi-GB file. Here the
 * only thing the direct upload needs is the raw `File` (its name seeds the
 * default dataset name; the columns are derived server-side by normalize).
 */
function RawFileDropzone({
  onRawFile,
  onUploadRemoved,
  children,
}: {
  onRawFile?: (file: File | null) => void;
  onUploadRemoved?: () => void;
  children?: (hasAcceptedFile: boolean) => React.ReactNode;
}) {
  const [zoneHover, setZoneHover] = useState(false);
  const [acceptedFile, setAcceptedFile] = useState<File | null>(null);

  const setFile = (file: File | null) => {
    setAcceptedFile(file);
    if (file) {
      onRawFile?.(file);
    } else {
      onRawFile?.(null);
      onUploadRemoved?.();
    }
  };

  return (
    <>
      <Box
        as="label"
        borderRadius={"lg"}
        borderWidth={2}
        borderColor={zoneHover ? "border.emphasized" : "border"}
        borderStyle="dashed"
        padding={10}
        textAlign="center"
        cursor="pointer"
        width="full"
        display="block"
        onDragOver={(event) => {
          event.preventDefault();
          setZoneHover(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setZoneHover(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setZoneHover(false);
          const file = event.dataTransfer?.files?.[0] ?? null;
          if (file) setFile(file);
        }}
      >
        <input
          type="file"
          accept=".csv,.json,.jsonl"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            if (file) setFile(file);
          }}
        />
        {acceptedFile ? (
          <Box
            bg="bg.muted"
            padding={4}
            borderRadius={"lg"}
            position="relative"
          >
            <VStack>
              <Text>{formatFileSize(acceptedFile.size)}</Text>
              <Text>{acceptedFile.name}</Text>
            </VStack>
            <Box
              position="absolute"
              right={-1}
              top={-1}
              onClick={(event) => {
                // Prevent the label from re-opening the file picker on remove.
                event.preventDefault();
                event.stopPropagation();
                setFile(null);
              }}
            >
              <Text fontSize="lg" lineHeight="1" cursor="pointer">
                ×
              </Text>
            </Box>
          </Box>
        ) : (
          <Text>Drop CSV or JSONL file or click here to upload</Text>
        )}
      </Box>
      {children ? children(acceptedFile !== null) : null}
    </>
  );
}
