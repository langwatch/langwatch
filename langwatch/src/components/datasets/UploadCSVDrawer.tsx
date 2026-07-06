import {
  Alert,
  Box,
  Button,
  Heading,
  HStack,
  Spacer,
  Spinner,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { CheckCircle, FileText, Trash2, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import type {
  DatasetColumns,
  DatasetRecordEntry,
} from "../../server/datasets/types";
import {
  MAX_FILE_SIZE_BYTES,
  MAX_ROWS_LIMIT,
} from "../../server/datasets/upload-utils";
import {
  type AddDatasetDrawerProps,
  AddOrEditDatasetDrawer,
} from "../AddOrEditDatasetDrawer";
import { Drawer } from "../ui/drawer";
import { toaster } from "../ui/toaster";
import {
  DROPZONE_DOTTED_STYLE,
  DropzonePrompt,
  dropzoneSurfaceProps,
  RAINBOW_TEXT_CSS,
} from "./datasetDropzoneStyles";
import {
  abortPendingUpload,
  DirectUploadUnavailableError,
  finalizeDirectUpload,
  PresignedUploadFailedError,
  putFileToPresignedUrl,
  requestDirectUpload,
  retryDatasetNormalize,
} from "./services/directUpload";
import { parseHeaderColumns } from "./utils/parseHeaderColumns";
import { getSafeColumnName } from "./utils/reservedColumns";

const logger = createLogger("UploadCSVDrawer");

export function UploadCSVDrawer({
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
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const onClose = onClose_ ?? closeDrawer;
  const isOpen = isOpen_ ?? true;

  const addDatasetDrawer = useDisclosure();
  const [localIsOpen, setLocalIsOpen] = useState(isOpen);
  const [uploadedDataset, setUploadedDataset] = useState<
    InMemoryDataset | undefined
  >(undefined);
  // Confirm-columns step (ADR-032 v19): when the form requests it, hold the
  // parsed columns + the resume callback and render the confirm drawer. Null
  // when no confirm is in progress (so the drawer — and its hooks — only mount
  // while confirming).
  const [columnConfirm, setColumnConfirm] = useState<{
    columns: DatasetColumns;
    proposedName: string;
    onConfirmed: (confirmed: {
      name: string;
      columnTypes: DatasetColumns;
    }) => void;
  } | null>(null);
  // Direct-upload (ADR-032 D4) processing stays IN this drawer: once the raw
  // file is streamed + finalized, the dataset normalizes server-side. We hold
  // its id and poll its status here instead of navigating to the dataset page,
  // so the whole async flow is observable without leaving the drawer.
  const [processingDatasetId, setProcessingDatasetId] = useState<string | null>(
    null,
  );

  const uploadCSVData = () => {
    setLocalIsOpen(false);
    addDatasetDrawer.onOpen();
  };

  const handleClose = () => {
    setProcessingDatasetId(null);
    onClose();
  };

  useEffect(() => {
    setLocalIsOpen(isOpen);
    if (!isOpen) {
      setUploadedDataset(undefined);
      setProcessingDatasetId(null);
      addDatasetDrawer.onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <>
      <Drawer.Root
        open={localIsOpen}
        onOpenChange={({ open }) => !open && handleClose()}
        size="xl"
      >
        <Drawer.Content bg="bg">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Heading>Upload CSV</Heading>
          </Drawer.Header>
          <Drawer.Body>
            {processingDatasetId && project ? (
              <DatasetUploadProcessing
                projectId={project.id}
                datasetId={processingDatasetId}
                onReady={(dataset) => {
                  onSuccess({
                    datasetId: dataset.id,
                    name: dataset.name,
                    columnTypes: (dataset.columnTypes ?? {}) as DatasetColumns,
                  });
                }}
                onViewDataset={() => {
                  const datasetId = processingDatasetId;
                  handleClose();
                  if (project) {
                    void router.push(`/${project.slug}/datasets/${datasetId}`);
                  }
                }}
              />
            ) : (
              <UploadCSVForm
                setUploadedDataset={setUploadedDataset}
                uploadedDataset={uploadedDataset}
                uploadCSVData={uploadCSVData}
                onCreateFromScratch={onCreateFromScratch}
                enableDirectUpload={enableDirectUpload}
                onClose={onClose}
                onDirectUploadComplete={setProcessingDatasetId}
                requestColumnConfirm={setColumnConfirm}
              />
            )}
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
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
      {/* Confirm-columns step for the direct path (ADR-032 v19): rename + retype
          the file's columns before the upload starts. localOnly so it never
          writes the DB itself — on Apply it returns the confirmed schema to the
          form (via onConfirmed), which then runs the direct upload. isColumnsLocked
          hides add/remove so the confirmed columns stay positionally aligned
          with the file the normalize job parses. */}
      {columnConfirm && (
        <AddOrEditDatasetDrawer
          open
          localOnly
          isColumnsLocked
          datasetToSave={{
            name: columnConfirm.proposedName,
            columnTypes: columnConfirm.columns,
          }}
          onClose={() => setColumnConfirm(null)}
          onSuccess={({ name, columnTypes }) => {
            const { onConfirmed } = columnConfirm;
            setColumnConfirm(null);
            onConfirmed({ name, columnTypes });
          }}
        />
      )}
    </>
  );
}

/**
 * In-drawer view for the async tail of a direct upload (ADR-032 D4): after the
 * raw file is finalized, the dataset normalizes server-side. This polls its
 * status (mirroring the dataset page's processing banner, so the UX is
 * identical) and surfaces processing / ready / failed states without leaving
 * the drawer. On ready it notifies the host (to refresh the list); navigating
 * to the dataset is an explicit user action, never automatic.
 */
export function DatasetUploadProcessing({
  projectId,
  datasetId,
  onReady,
  onViewDataset,
}: {
  projectId: string;
  datasetId: string;
  onReady: (dataset: {
    id: string;
    name: string;
    columnTypes: unknown;
  }) => void;
  onViewDataset: () => void;
}) {
  const [isRetrying, setIsRetrying] = useState(false);
  const datasetQuery = api.dataset.getById.useQuery(
    { projectId, datasetId },
    {
      enabled: !!projectId && !!datasetId,
      // Poll only while preparing, then stop — same contract as the dataset
      // page. `finalizeUpload` always flips the row to "processing" before
      // normalize runs, so "ready" is only ever reached once normalize has
      // finished; we don't second-guess it (a degenerate columnless dataset is
      // still terminally ready, not an endless spinner).
      refetchInterval: (data) =>
        data?.status === "processing" || data?.status === "uploading"
          ? 3000
          : false,
    },
  );

  const data = datasetQuery.data;
  // `getById` (findFirst, archivedAt: null) returns null for a missing/archived
  // dataset — a terminal state, NOT "still preparing" (else the spinner hangs
  // forever, since refetchInterval also stops on null).
  const datasetGone = datasetQuery.isFetched && data == null;
  const isFailed = data?.status === "failed";
  const isReady = data?.status === "ready";
  const isProcessing = !datasetGone && !isFailed && !isReady;

  useEffect(() => {
    if (isReady && data) {
      onReady({ id: data.id, name: data.name, columnTypes: data.columnTypes });
    }
    // Fire once on the transition to ready; onReady just refreshes the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await retryDatasetNormalize({ projectId, datasetId });
      await datasetQuery.refetch();
    } catch (error) {
      toaster.create({
        title: "Could not retry",
        description:
          error instanceof Error
            ? error.message
            : "Please try again in a moment.",
        type: "error",
        meta: { closable: true },
      });
    } finally {
      setIsRetrying(false);
    }
  };

  const rowStatus: DatasetFileStatus =
    isFailed || datasetGone ? "error" : isReady ? "ready" : "uploading";

  // Same row treatment as the dropzone, so the upload → prepare → ready flow
  // reads as one continuous file row rather than swapping to a banner.
  return (
    <VStack width="full" align="stretch" gap={4}>
      <DatasetFileRow
        name={data?.name ?? "Your dataset"}
        status={rowStatus}
        metaLabel={
          isReady
            ? "Ready"
            : isProcessing
              ? "Preparing your dataset, this can take a few minutes"
              : undefined
        }
        message={
          datasetGone
            ? "This dataset is no longer available."
            : isFailed
              ? (data?.statusError ??
                "Something went wrong while processing your file. You can retry.")
              : undefined
        }
        action={
          isFailed ? (
            <Button
              size="sm"
              colorPalette="red"
              variant="outline"
              loading={isRetrying}
              onClick={() => void handleRetry()}
            >
              Retry
            </Button>
          ) : isReady ? (
            <Button size="sm" colorPalette="blue" onClick={onViewDataset}>
              View dataset
            </Button>
          ) : undefined
        }
      />
    </VStack>
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
  onDirectUploadComplete,
  requestColumnConfirm,
}: {
  setUploadedDataset: (dataset: InMemoryDataset | undefined) => void;
  uploadedDataset: InMemoryDataset | undefined;
  onCreateFromScratch?: () => void;
  uploadCSVData: () => void;
  disabled?: boolean;
  /** When true, "Upload" streams the raw file to storage; the host then shows
   *  processing in the drawer. Falls back to the parse-and-drawer flow if
   *  storage is off. */
  enableDirectUpload?: boolean;
  onClose?: () => void;
  /** Called with the new dataset id once a direct upload is finalized, so the
   *  host (UploadCSVDrawer) takes over and shows processing IN the drawer.
   *  When omitted, the direct path navigates to the dataset page instead. */
  onDirectUploadComplete?: (datasetId: string) => void;
  /** Host-provided confirm-columns step (ADR-032 v19). When set, the direct
   *  path hands the parsed header columns to the host before uploading; the host
   *  shows the confirm drawer and calls `onConfirmed` with the final name +
   *  columnTypes. When omitted (standalone form), the upload runs without a
   *  confirm step (normalize derives all-`string`). */
  requestColumnConfirm?: (params: {
    columns: DatasetColumns;
    proposedName: string;
    onConfirmed: (confirmed: {
      name: string;
      columnTypes: DatasetColumns;
    }) => void;
  }) => void;
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
  // Confirm-columns step (ADR-032 v19, direct path only): the columns parsed
  // from the file's header (null when the header couldn't be read → upload
  // without a confirm step) and the proposed dataset name. The host renders the
  // confirm drawer (see `requestColumnConfirm`); the user corrects names + types
  // before the upload starts.
  const [parsedColumns, setParsedColumns] = useState<DatasetColumns | null>(
    null,
  );
  const [proposedName, setProposedName] = useState<string>("");
  // The header parse runs async on file pick; Upload must wait for it so a fast
  // click can't bypass the confirm step. A monotonic token discards a stale
  // parse (from a since-removed/replaced file) so it never overwrites the
  // current file's columns.
  const [isParsingHeader, setIsParsingHeader] = useState(false);
  const parseHeaderTokenRef = useRef(0);
  // System/drawer-level failure (storage not writable, upload failed) → top
  // alert. File-level validation (too large / over the row limit) → inline on
  // the file's row (sizeError + overRowLimitForFallback below).
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  // Abort handle for the in-flight PUT + the pending dataset it minted, so a
  // user-initiated cancel can stop the stream and reap the orphaned row.
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingDatasetIdRef = useRef<string | null>(null);

  // Closing the drawer mid-upload unmounts this form — abort the in-flight PUT
  // so it doesn't silently finalize a dataset behind the user's back. The refs
  // are nulled the instant the PUT succeeds (before finalize), so this aborts
  // only a genuinely in-flight stream; the AbortError catch then reaps the
  // pending row. No-op (ref null) on a normal close or the processing handoff.
  useEffect(() => {
    return () => abortControllerRef.current?.abort();
  }, []);

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
  const handleUpload = async (confirmed?: {
    name: string;
    columnTypes: DatasetColumns;
  }) => {
    if (!enableDirectUpload || !rawFile || !projectId || !project) {
      uploadCSVData();
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    // Track the pending dataset so a presigned-PUT failure can clean up the
    // orphaned `uploading` row before falling back. The refs mirror these so a
    // user-initiated cancel can abort the stream and reap the same row.
    const controller = new AbortController();
    abortControllerRef.current = controller;
    pendingDatasetIdRef.current = null;
    let pendingDatasetId: string | undefined;
    try {
      const name =
        confirmed?.name ??
        uploadedDataset?.name ??
        (await proposeValidName(rawFile.name));
      const { datasetId, uploadUrl } = await requestDirectUpload({
        projectId,
        name,
        filename: rawFile.name,
        // Confirmed columns (names + types) drive normalize's rename + type
        // conversion. Absent when the header couldn't be parsed → normalize
        // derives all-`string`.
        columnTypes: confirmed?.columnTypes,
      });
      pendingDatasetId = datasetId;
      pendingDatasetIdRef.current = datasetId;
      await putFileToPresignedUrl(uploadUrl, rawFile, controller.signal);
      // The PUT succeeded — we're now committed to finalizing, so a cancel must
      // NOT reap the row. Clear the abort/reap handles BEFORE finalize (not
      // after) to close the cancel-after-finalize double-reap race.
      abortControllerRef.current = null;
      pendingDatasetIdRef.current = null;
      await finalizeDirectUpload({ projectId, datasetId });

      if (onDirectUploadComplete) {
        // Hand off to the drawer host, which polls status and shows the
        // processing → ready/failed flow in place (no navigation).
        setIsUploading(false);
        onDirectUploadComplete(datasetId);
      } else {
        toaster.create({
          title: "Preparing your dataset",
          type: "success",
          meta: { closable: true },
        });
        setIsUploading(false);
        onClose?.();
        void router.push(`/${project.slug}/datasets/${datasetId}`);
      }
    } catch (error) {
      // A user-initiated cancel aborts the PUT (AbortError) OR lands while
      // requestDirectUpload() is still pending. The presign call is deliberately
      // NOT wired to the abort signal (aborting its fetch could strand a row the
      // server minted but whose id we never received), so it runs to completion
      // and may resolve OR reject — e.g. DirectUploadUnavailableError on a
      // no-storage install — AFTER the cancel. In that window we must NOT run the
      // fallback parse or surface an error for an upload the user already
      // cancelled. `controller.signal.aborted` is the precise "cancelled while
      // this attempt was live" flag (handleCancelUpload only aborts a controller
      // still held by the ref; once the PUT succeeds the ref is nulled, so a
      // later cancel can't set it), so treat it like AbortError: reap any row the
      // presign minted (the ref holds that id exactly when it hasn't been reaped
      // yet; a cancel during the PUT already reaped and nulled it → no double
      // reap) and bail before any fallback/error handling.
      if (
        (error instanceof Error && error.name === "AbortError") ||
        controller.signal.aborted
      ) {
        const strandedId = pendingDatasetIdRef.current;
        pendingDatasetIdRef.current = null;
        if (strandedId && projectId) {
          void abortPendingUpload({
            projectId,
            datasetId: strandedId,
          }).catch((cleanupError) => {
            logger.error(
              { error: cleanupError },
              "Failed to clean up cancelled upload",
            );
          });
        }
        return;
      }
      // Any failure AFTER requestDirectUpload minted the `uploading` row leaves
      // it behind and locks the slug — whether we fall back (a fresh dataset is
      // created) or surface the error (the upload is abandoned). Reap it either
      // way so a retry isn't blocked. `DirectUploadUnavailableError` throws
      // BEFORE the row exists (pendingDatasetId undefined → no-op), and a
      // same-origin local-FS PUT failure (StorageNotWritable, a plain Error)
      // hits the surface-error branch below — which previously stranded the row.
      if (pendingDatasetId) {
        try {
          await abortPendingUpload({ projectId, datasetId: pendingDatasetId });
        } catch (cleanupError) {
          logger.error(
            { error: cleanupError },
            "Failed to clean up pending upload",
          );
        }
      }
      // No browser-reachable storage at all (DirectUploadUnavailable): the
      // install simply has no S3 → fall back to the in-browser parse path. A
      // large file there hits the size guard with the accurate "requires object
      // storage" message.
      if (error instanceof DirectUploadUnavailableError) {
        // Parse the already-captured file NOW (the first and only in-browser
        // parse on this path) and hand off to the existing parse-and-drawer flow.
        await runFallbackParseAndDrawer(rawFile, "no-storage");
        return;
      }
      // Storage IS configured but the cross-origin presigned PUT was rejected —
      // almost always a missing/incorrect bucket CORS rule (an opaque fetch
      // TypeError carries no status). This silently degrades the headline
      // direct-upload path to the legacy in-browser one, so log it LOUDLY for
      // operators — the UI can't (and per copywriting.md shouldn't) explain CORS
      // to an end user. Then fall back for small files (resilience) but show an
      // accurate error for large ones — never the false "requires object storage"
      // when storage is in fact configured.
      if (error instanceof PresignedUploadFailedError) {
        logger.error(
          { error, fileSizeBytes: rawFile.size, projectId },
          "Direct-to-storage upload failed: presigned PUT rejected (likely a missing bucket CORS rule or storage connectivity). Falling back to in-browser parse.",
        );
        await runFallbackParseAndDrawer(rawFile, "presign-failed");
        return;
      }
      // A same-origin local-FS failure (e.g. StorageNotWritable) is a real,
      // actionable server error — surface it verbatim, no fallback parse.
      logger.error({ error }, "Direct dataset upload failed");
      // System error → top alert; clear any file-level error so the two never
      // render the shared `upload-error` testid at once.
      setSizeError(null);
      setUploadError(
        error instanceof Error
          ? error.message
          : "Something went wrong uploading your file. Please try again.",
      );
      setIsUploading(false);
    }
  };

  /**
   * Cancel an in-flight direct upload: abort the streaming PUT and reap the
   * pending `uploading` row so its slug isn't locked on retry. The dropzone's
   * cancel control additionally clears the selected file (re-expanding the drop
   * zone) — see `RawFileDropzone`'s cancel handler — so the user starts fresh.
   */
  const handleCancelUpload = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    const pendingId = pendingDatasetIdRef.current;
    pendingDatasetIdRef.current = null;
    if (pendingId && projectId) {
      void abortPendingUpload({ projectId, datasetId: pendingId }).catch(
        (error) => {
          logger.error({ error }, "Failed to clean up cancelled upload");
        },
      );
    }
    setIsUploading(false);
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
  const runFallbackParseAndDrawer = async (
    file: File,
    reason: "no-storage" | "presign-failed",
  ) => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      // Exhaustive map (not a ternary): widening the `reason` union surfaces a
      // compile error here instead of silently defaulting to one message.
      //  - presign-failed: storage IS configured, the direct upload to it
      //    failed — do NOT claim the deployment lacks object storage (the
      //    misleading message a real user hit). Operator-facing CORS/
      //    connectivity detail is in the log; the UI stays jargon-free
      //    (copywriting.md).
      //  - no-storage: the deployment genuinely has no object storage.
      const oversizeMessage: Record<typeof reason, string> = {
        "presign-failed":
          "We couldn't upload your file to storage. Please try again, or contact your administrator if the problem persists.",
        "no-storage":
          "This file is too large to upload on this deployment. Large uploads require object storage.",
      };
      // File-level error → inline row; clear any system error for exclusivity.
      setUploadError(null);
      setSizeError(oversizeMessage[reason]);
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
      setSizeError(null);
      setUploadError(
        error instanceof Error
          ? error.message
          : "Something went wrong reading your file. Please try again.",
      );
      setIsUploading(false);
    }
  };

  /**
   * Upload button handler. On the direct path with a parseable header AND a host
   * that can show the confirm drawer, hand the parsed columns to the host first
   * (ADR-032 v19) so the user fixes names + types before the upload starts; the
   * host calls back `onConfirmed` with the final schema, which resumes
   * `handleUpload`. Without a host confirm handler (standalone form) or an
   * unparseable header, upload straight away — normalize then derives
   * all-`string` columns as before.
   */
  const handleUploadClick = () => {
    if (
      enableDirectUpload &&
      rawFile &&
      parsedColumns &&
      requestColumnConfirm
    ) {
      requestColumnConfirm({
        columns: parsedColumns,
        proposedName,
        onConfirmed: (confirmed) => void handleUpload(confirmed),
      });
      return;
    }
    void handleUpload();
  };

  // The direct path streams the raw file, so it is not bound by the in-browser
  // row limit. The limit only constrains the fallback (parse-and-drawer) flow.
  const overRowLimitForFallback =
    !enableDirectUpload &&
    !!uploadedDataset &&
    uploadedDataset.datasetRecords.length > MAX_ROWS_LIMIT;

  const canUpload = enableDirectUpload
    ? // Wait for the header parse to settle so a fast click can't bypass confirm.
      !!rawFile && !isParsingHeader
    : !!uploadedDataset &&
      uploadedDataset.datasetRecords.length > 0 &&
      !overRowLimitForFallback;

  // File-level validation, shown inline on the file's row: too-large (fallback)
  // or over the in-browser row limit.
  const fileError = overRowLimitForFallback
    ? `Sorry, the max number of rows accepted for datasets is currently ${MAX_ROWS_LIMIT} rows. Please reduce the number of rows or contact support.`
    : (sizeError ?? undefined);

  return (
    <VStack width="full" align="start" gap={4}>
      {uploadError && (
        <Alert.Root status="error" width="full">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description data-testid="upload-error">
              {uploadError}
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
      <CSVReaderComponent
        // Direct path: capture only the raw File (no parse). Fallback/picker
        // path: parse immediately for synchronous columns/records.
        parse={!enableDirectUpload}
        uploadStatus={
          isUploading && enableDirectUpload ? "uploading" : undefined
        }
        fileError={fileError}
        onCancel={handleCancelUpload}
        onUploadAccepted={handleUploadAccepted}
        onRawFile={(file) => {
          setRawFile(file);
          setUploadError(null);
          setSizeError(null);
          setParsedColumns(null);
          // Bump the token so any in-flight parse from a previous file is
          // discarded when it resolves (no stale overwrite).
          const token = ++parseHeaderTokenRef.current;
          // Read just the header (bounded slice — never the whole file) so the
          // confirm step can show the file's columns. Best-effort: on an
          // unreadable header the upload proceeds without confirm. Upload stays
          // disabled (`isParsingHeader`) until this settles. Only when a confirm
          // host is wired — without it the parse result is unused, so a standalone
          // form neither parses nor blocks.
          if (file && enableDirectUpload && requestColumnConfirm) {
            setIsParsingHeader(true);
            void (async () => {
              try {
                const [columns, name] = await Promise.all([
                  parseHeaderColumns(file),
                  proposeValidName(file.name),
                ]);
                if (parseHeaderTokenRef.current !== token) return; // stale
                setParsedColumns(columns);
                setProposedName(name);
              } catch (error) {
                // Best-effort: an unreadable header just skips the confirm step
                // (parsedColumns stays null → upload proceeds, normalize derives).
                logger.error(
                  { error },
                  "Failed to parse dataset header columns",
                );
              } finally {
                if (parseHeaderTokenRef.current === token) {
                  setIsParsingHeader(false);
                }
              }
            })();
          }
        }}
        onUploadRemoved={() => {
          setUploadedDataset(undefined);
          setRawFile(null);
          setUploadError(null);
          setSizeError(null);
          setParsedColumns(null);
          // Invalidate any in-flight parse and clear the pending state.
          parseHeaderTokenRef.current++;
          setIsParsingHeader(false);
        }}
      />
      <HStack width="full" align="end">
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
          loadingText="Uploading"
          disabled={!!disabled || isUploading || !canUpload}
          onClick={handleUploadClick}
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
  uploadStatus,
  fileError,
  onCancel,
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
  /** "uploading" while the no-parse raw file streams to storage. */
  uploadStatus?: "uploading";
  /** File-level validation/upload message; renders the file row in an error state. */
  fileError?: string;
  /** Cancels an in-flight upload (no-parse path). Shows the X cancel control. */
  onCancel?: () => void;
  children?: (hasAcceptedFile: boolean) => React.ReactNode;
}) {
  if (!parse) {
    return (
      <RawFileDropzone
        onRawFile={onRawFile}
        onUploadRemoved={onUploadRemoved}
        uploadStatus={uploadStatus}
        fileError={fileError}
        onCancel={onCancel}
      >
        {children}
      </RawFileDropzone>
    );
  }

  return (
    <ParsingCSVReader
      onUploadAccepted={onUploadAccepted}
      onUploadRemoved={onUploadRemoved}
      fileError={fileError}
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
  fileError,
  children,
}: {
  onUploadAccepted: (results: {
    data: string[][];
    acceptedFile: File;
  }) => void | Promise<void>;
  onUploadRemoved?: () => void;
  fileError?: string;
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
              fileError={fileError}
              getRootProps={getRootProps}
              getRemoveFileProps={getRemoveFileProps}
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

type DatasetFileStatus = "selected" | "uploading" | "ready" | "error";

function DatasetFileStatusIcon({ status }: { status: DatasetFileStatus }) {
  if (status === "uploading") return <Spinner size="sm" color="blue.500" />;
  if (status === "ready")
    return (
      <Box color="green.500" display="flex">
        <CheckCircle size={20} />
      </Box>
    );
  if (status === "error")
    return (
      <Box color="red.500" display="flex">
        <XCircle size={20} />
      </Box>
    );
  return (
    <Box color="fg.muted" display="flex">
      <FileText size={20} />
    </Box>
  );
}

/**
 * A file presented as a status row (Image #5): status icon, file name, a
 * "size · meta" sub-line, and a trailing action slot (remove, cancel, …). The
 * error state turns the row red and shows the message in place of the meta.
 */
function DatasetFileRow({
  name,
  sizeLabel,
  metaLabel,
  status,
  message,
  action,
}: {
  name: string;
  sizeLabel?: string;
  metaLabel?: string;
  status: DatasetFileStatus;
  message?: string;
  action?: React.ReactNode;
}) {
  const isError = status === "error";
  const isUploading = status === "uploading";
  const meta = message ?? metaLabel;
  return (
    <HStack
      width="full"
      gap={3}
      padding={3}
      borderWidth="1px"
      borderRadius="lg"
      borderColor={isError ? "red.400" : "border"}
      bg="bg"
    >
      <DatasetFileStatusIcon status={status} />
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        <Text
          fontWeight="medium"
          truncate
          maxWidth="full"
          // The name sweeps a rainbow gradient while uploading — the "loading" tell.
          css={isUploading ? RAINBOW_TEXT_CSS : undefined}
        >
          {name}
        </Text>
        {(sizeLabel ?? meta) && (
          <HStack gap={2} fontSize="xs" color="fg.muted">
            {sizeLabel && <Text>{sizeLabel}</Text>}
            {sizeLabel && meta && <Text color="border">|</Text>}
            {meta && (
              <Text
                color={isError ? "red.500" : "fg.muted"}
                data-testid={isError ? "upload-error" : undefined}
              >
                {meta}
              </Text>
            )}
          </HStack>
        )}
      </VStack>
      {action}
    </HStack>
  );
}

/** Trash-style remove control for a file row. */
function RemoveFileButton({ onRemove }: { onRemove: () => void }) {
  return (
    <Box
      as="button"
      color="fg.muted"
      display="flex"
      _hover={{ color: "red.500" }}
      aria-label="Remove file"
      onClick={(event: React.MouseEvent) => {
        // Prevent a wrapping label from re-opening the file picker on remove.
        event.preventDefault();
        event.stopPropagation();
        onRemove();
      }}
    >
      <Trash2 size={18} />
    </Box>
  );
}

/** X control shown in place of the trash while an upload is in flight. */
function CancelUploadButton({ onCancel }: { onCancel: () => void }) {
  return (
    <Box
      as="button"
      color="fg.muted"
      display="flex"
      _hover={{ color: "red.500" }}
      aria-label="Cancel upload"
      onClick={(event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <X size={18} />
    </Box>
  );
}

function CSVReaderBox({
  acceptedFile,
  setAcceptedFile,
  zoneHover,
  fileError,
  getRootProps,
  getRemoveFileProps,
  ProgressBar,
}: {
  acceptedFile: File | null;
  setAcceptedFile: (file: File | null) => void;
  zoneHover: boolean;
  /** File-level validation message (e.g. over the row limit); turns the row red. */
  fileError?: string;
  getRootProps: () => Record<string, unknown>;
  getRemoveFileProps: () => Record<string, unknown>;
  ProgressBar: React.ComponentType;
}) {
  useEffect(() => {
    setAcceptedFile(acceptedFile);
  }, [acceptedFile, setAcceptedFile]);

  return (
    <VStack width="full" gap={0} align="stretch">
      {/* Single-file flow: the drag-and-drop container collapses once a file is
          chosen and expands back when it's removed. */}
      <Box
        display="grid"
        gridTemplateRows={acceptedFile ? "0fr" : "1fr"}
        opacity={acceptedFile ? 0 : 1}
        transition="grid-template-rows 0.35s ease, opacity 0.3s ease"
      >
        <Box overflow="hidden">
          <Box
            {...getRootProps()}
            {...dropzoneSurfaceProps(zoneHover)}
            style={DROPZONE_DOTTED_STYLE}
          >
            <DropzonePrompt />
          </Box>
        </Box>
      </Box>
      {acceptedFile && (
        <DatasetFileRow
          name={acceptedFile.name}
          sizeLabel={formatFileSize(acceptedFile.size)}
          status={fileError ? "error" : "selected"}
          message={fileError}
          action={
            <Box
              as="button"
              color="fg.muted"
              display="flex"
              _hover={{ color: "red.500" }}
              aria-label="Remove file"
              {...getRemoveFileProps()}
            >
              <Trash2 size={18} />
            </Box>
          }
        />
      )}
      <ProgressBar />
    </VStack>
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
  uploadStatus,
  fileError,
  onCancel,
  children,
}: {
  onRawFile?: (file: File | null) => void;
  onUploadRemoved?: () => void;
  /** Set to "uploading" while the raw file streams to storage. */
  uploadStatus?: "uploading";
  /** File-level validation/upload message; turns the row red. */
  fileError?: string;
  /** Cancels the in-flight upload; shows the X cancel control while uploading. */
  onCancel?: () => void;
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

  const isUploading = uploadStatus === "uploading";
  const rowStatus: DatasetFileStatus = fileError
    ? "error"
    : isUploading
      ? "uploading"
      : "selected";

  return (
    <VStack width="full" gap={0} align="stretch">
      {/* Single-file flow: the drag-and-drop container smoothly collapses once a
          file is chosen and expands back when it's removed or cancelled. The
          grid 1fr→0fr trick animates the height without measuring it. */}
      <Box
        display="grid"
        gridTemplateRows={acceptedFile ? "0fr" : "1fr"}
        opacity={acceptedFile ? 0 : 1}
        transition="grid-template-rows 0.35s ease, opacity 0.3s ease"
      >
        <Box overflow="hidden">
          <Box
            as="label"
            {...dropzoneSurfaceProps(zoneHover)}
            style={DROPZONE_DOTTED_STYLE}
            display="block"
            // Observable drag-active state (the highlight itself is CSS-only).
            data-active={zoneHover ? "true" : "false"}
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
                // Reset the native value so re-picking the SAME file after a
                // remove still fires `change` (otherwise the unchanged value
                // suppresses it and Upload stays disabled).
                event.target.value = "";
              }}
            />
            <DropzonePrompt />
          </Box>
        </Box>
      </Box>
      {acceptedFile && (
        <DatasetFileRow
          name={acceptedFile.name}
          sizeLabel={formatFileSize(acceptedFile.size)}
          metaLabel={new Date(acceptedFile.lastModified).toLocaleDateString()}
          status={rowStatus}
          message={fileError}
          action={
            isUploading ? (
              onCancel ? (
                <CancelUploadButton
                  onCancel={() => {
                    // Cancel aborts the upload AND clears the file, so the
                    // drag-and-drop container expands back in.
                    onCancel();
                    setFile(null);
                  }}
                />
              ) : undefined
            ) : (
              <RemoveFileButton onRemove={() => setFile(null)} />
            )
          }
        />
      )}
      {children ? children(acceptedFile !== null) : null}
    </VStack>
  );
}
