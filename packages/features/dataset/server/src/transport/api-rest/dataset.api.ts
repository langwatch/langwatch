/**
 * Public REST API for datasets.
 *
 * Mounted at `/api/dataset`. Every verb dispatches through `DatasetApp`, the
 * same application the tRPC doors call; this file owns the wire contract —
 * route names, request schemas, response shapes, status codes and the
 * domain-error mapping — and nothing else.
 *
 * The application, the platform-URL builder and the direct-upload authorizer
 * all arrive as arguments rather than being imported, so the family can be
 * mounted into any process that has them and can be BUILT (for the OpenAPI
 * document and the route-authorization audits) by a process that has none.
 *
 * Spec: packages/features/dataset/specs/.
 */
import { Readable } from "node:stream";
import { handlerManagedAuth, requires } from "@langwatch/api";
import {
  type AppRestSecurity,
  BadRequestError,
  baseResponses,
  buildStandardSuccessResponse,
  type EndpointVariables,
  errorSchema,
  InternalServerError,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  NotFoundError,
  type PlatformUrlBuilder,
  projectOf,
  type ProjectScopedContext,
  resolver,
  type RestErrorHandler,
  UnprocessableEntityError,
} from "@langwatch/api/rest";
import {
  datasetColumnsSchema,
  datasetColumnTypeSchema,
  datasetConfirmColumnsSchema,
  type DatasetColumns,
  type DatasetConfirmColumns,
} from "@langwatch/dataset-contract";
// The server's class, not the contract's same-named one: the upload adapter
// throws this one, and `instanceof` against the contract's is always false —
// which sent every column-mismatch and over-size upload to the customer as a
// 500 instead of the 400 the branches below build.
import { type DatasetNotReadyError, UploadValidationError } from "@langwatch/dataset-contract";
import { z } from "zod";
import type { DatasetApp } from "#app/dataset.app";
import { createDatasetErrorHandler } from "./dataset-error-handler.api.ts";
import { datasetOutputSchema } from "../../rules/dataset-schemas.rules.ts";

/**
 * The read ceiling for `GET /api/dataset/:slugOrId`, which answers with the
 * whole dataset inline. A dataset above it is refused rather than truncated.
 */
const MAX_LIMIT_MB = 25;

/**
 * Why every route on this family declares its answer in prose rather than a
 * schema: the doors below choose their status per outcome (201 or 200 on an
 * upsert, 409 on a slug collision, 425 with the lifecycle state while a
 * dataset is still preparing) and one of them streams the request body
 * straight to storage. A single declared output schema could not describe
 * those answers, and validating one would rewrite bytes an integrator parses.
 */
const DATASET_ANSWER_REASON =
  "the dataset doors choose their status per outcome (201/200, 409 Conflict, 425 DatasetNotReady) and answer with the body their callers already parse";

/**
 * What the direct-upload routes get back when they ask whether this caller may
 * drive an upload for `projectId`.
 *
 * `body` is the full handled payload for the failures that have one (currently
 * only the API-key ceiling denial: code, permission, tips, docsUrl). Routes
 * answer with it in preference to `error`, which is only a sentence.
 */
export type DatasetDirectUploadAuthorization =
  | { ok: true; projectId: string; teamId: string }
  | { ok: false; status: 401 | 403; error: string; body?: object };

/**
 * Authorizes a direct-upload request for one project.
 *
 * These routes are driven by the in-app upload UI, which authenticates with a
 * browser session rather than an API key, so they resolve the caller inside the
 * handler. Doing that reads sessions, API keys and role bindings out of the
 * application's database, which is why it arrives here as a port.
 */
export type DatasetDirectUploadAuthorizer = (
  c: DatasetDirectUploadRequestReader,
  projectId: string,
) => Promise<DatasetDirectUploadAuthorization>;

/**
 * The whole of the request an authorizer reads: the raw `Request` it resolves a
 * session or an API key from, and the headers it reads the same-site signal
 * from. Named structurally rather than as Hono's `Context`, which is invariant
 * in its variables map and would refuse the handler context this family builds.
 */
export type DatasetDirectUploadRequestReader = {
  req: { raw: Request; header(name: string): string | undefined };
};

// -- Validation schemas for new endpoints --

const columnTypeSchema = z.object({
  name: z.string(),
  type: datasetColumnTypeSchema,
});

const createDatasetSchema = z.object({
  name: z.string().min(1, "name is required"),
  columnTypes: z.array(columnTypeSchema).optional().default([]),
});

const updateDatasetSchema = z.object({
  name: z.string().min(1).optional(),
  columnTypes: z.array(columnTypeSchema).optional(),
});

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

const updateRecordSchema = z.object({
  entry: z.record(z.string(), z.any()),
});

const deleteRecordsSchema = z.object({
  recordIds: z
    .array(z.string())
    .min(1, "recordIds is required")
    .max(1000, "Maximum 1000 records per batch delete"),
});

const batchCreateRecordsSchema = z.object({
  entries: z
    .array(z.record(z.string(), z.any()))
    .min(1, "entries is required")
    .max(1000, "Maximum batch size is 1000 entries"),
});

const legacyEntriesSchema = z
  .object({
    entries: z.array(z.record(z.string(), z.any())).meta({
      example: [
        {
          input: "hi",
          output: "Hello, how can I help you today?",
        },
      ],
    }),
  })
  .meta({ id: "DatasetPostEntries" });

const slugOrIdParamsSchema = z.object({ slugOrId: z.string() });
const slugParamsSchema = z.object({ slug: z.string() });
const recordParamsSchema = z.object({ slugOrId: z.string(), recordId: z.string() });
const uploadIdParamsSchema = z.object({ uploadId: z.string() });
const datasetIdParamsSchema = z.object({ datasetId: z.string() });

/**
 * Maps DatasetNotFoundError from the service layer to the HTTP NotFoundError.
 * The service throws domain errors; the route handler translates them to HTTP errors.
 *
 * NOTE: the direct-upload routes instead let domain errors propagate to
 * the family's `onError` (the `DOMAIN_ERROR_HTTP` table). These older
 * slug/record routes still map inline. Both reach 404 for a missing dataset;
 * if you change a status/code, update both sites until they're unified.
 */
function mapDatasetNotFoundError(error: unknown): never {
  if (error instanceof Error && error.name === "DatasetNotFoundError") {
    throw new NotFoundError("Dataset not found");
  }
  throw error;
}

/**
 * ADR-032 Decision 6 / I-READY: a still-preparing (or failed) dataset is not
 * served as data. Map `DatasetNotReadyError` to 425 Too Early with the
 * lifecycle `status` in the body so the caller knows whether to poll
 * (`processing`) or stop (`failed`). Returns `undefined` when the error isn't a
 * not-ready error, so the caller falls through to its existing mapping.
 */
function mapDatasetNotReadyError(
  error: unknown,
  c: { json: (body: unknown, status: 425) => Response },
): Response | undefined {
  if (error instanceof Error && error.name === "DatasetNotReadyError") {
    const notReady = error as DatasetNotReadyError;
    return c.json(
      {
        error: "DatasetNotReady",
        status: notReady.status,
        message: notReady.message,
      },
      425,
    );
  }
  return undefined;
}

/**
 * The dataset REST family, built against one process's security and services.
 */
export function createDatasetRestApp(options: {
  security: AppRestSecurity;
  /**
   * The feature's application, resolved per request. Mounting the family must
   * not force it to be constructed, which is what lets the OpenAPI generator
   * and the route-registry audits build every route without a running process.
   */
  app: () => DatasetApp;
  platformUrl: PlatformUrlBuilder;
  authorizeDirectUpload: DatasetDirectUploadAuthorizer;
}): MountableRestApp {
  const { security, app, platformUrl, authorizeDirectUpload } = options;

  // `bareMount`: `/api/dataset/...` is the whole published contract. A dated
  // namespace beside it would add a second address for every door, and its
  // version guard would claim `/api/dataset/:apiVersion{…}/*` — the same shape
  // as `/api/dataset/:slugOrId`.
  //
  // The family's own error mapping (domain errors → HTTP codes) is layered
  // over the legacy boundary, exactly as the raw-Hono `onError` did.
  const { service, policy } = security.createProjectVersionedApp({
    name: "dataset",
    basePath: "/api/dataset",
    errorEnvelope: "legacy",
    bareMount: true,
    errorHandler: (boundary: RestErrorHandler) =>
      createDatasetErrorHandler({ boundaryErrorHandler: boundary }),
  });

  type DatasetContext = ProjectScopedContext<EndpointVariables>;

  // The browser→S3 direct-upload routes authenticate the in-app upload UI by
  // NextAuth session cookie (or API key), resolved in-handler — the rest of the
  // surface is API-key-only `requires(...)`, which would 401 a cookie request.
  const directUploadSessionAuth = handlerManagedAuth({
    reason:
      "upload UI authenticated in-handler via authorizeDirectUpload (session cookie or API key)",
    // authorizeDirectUpload resolves the caller and the target dataset; it does
    // not gate on a standalone RBAC permission.
    permissions: [],
    credential: "both",
  });

  // The application arrives as a provider rather than being read off the
  // request: mounting the family must not force it to be constructed, which is
  // what lets the OpenAPI generator and the route-registry audits build every
  // route with none.

  // ── List Datasets (paginated) ──────────────────────────────────
  service.registerRoute(
    "get",
    "/",
    MANAGEMENT_API_VERSION,
    async (c: DatasetContext, input: z.infer<typeof paginationQuerySchema>) => {
      const project = projectOf(c);
      const { page, limit } = input;
      const application = app();

      const result = await application.listDatasets({
        projectId: project.id,
        page,
        limit,
      });

      return c.json({
        ...result,
        data: result.data.map((d: { id: string; slug?: string }) => ({
          ...d,
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/datasets/${d.id}`,
          }),
        })),
      });
    },
    (b) =>
      policy(requires("datasets:view"))(b)
        .withQuery(paginationQuerySchema)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({
          description: "List all non-archived datasets for the project (paginated)",
        }),
  );

  // ── Create Dataset ─────────────────────────────────────────────
  // Creating asks for `datasets:create`, not `datasets:manage`. `:manage` still
  // implies `:create` through the RBAC hierarchy, so every role and key that
  // could create a dataset yesterday still can — what changes is that a
  // credential the product issues at the CREATE grain is honoured instead of
  // refused. A viewer holds only `datasets:view` and is declined as before.
  service.registerRoute(
    "post",
    "/",
    MANAGEMENT_API_VERSION,
    async (c: DatasetContext, input: z.infer<typeof createDatasetSchema>) => {
      const project = projectOf(c);
      const { name, columnTypes } = input;
      const application = app();

      try {
        const dataset = await application.upsertDataset({
          projectId: project.id,
          name,
          columnTypes,
        });

        return c.json(
          {
            id: dataset.id,
            name: dataset.name,
            slug: dataset.slug,
            columnTypes: dataset.columnTypes,
            createdAt: dataset.createdAt,
            updatedAt: dataset.updatedAt,
            platformUrl: platformUrl({
              projectSlug: project.slug,
              path: `/datasets/${dataset.id}`,
            }),
          },
          201,
        );
      } catch (error) {
        if (error instanceof Error && error.name === "DatasetConflictError") {
          return c.json(
            {
              error: "Conflict",
              message: "A dataset with this slug already exists",
            },
            409,
          );
        }
        throw error;
      }
    },
    (b) =>
      policy(requires("datasets:create"))(b)
        .withInput(createDatasetSchema)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({ description: "Create a new dataset" }),
  );

  // ── Create + Upload Dataset from File ─────────────────────────
  // IMPORTANT: This route MUST be registered BEFORE /:slugOrId routes
  // so the router doesn't match "upload" as a slugOrId parameter.
  // Also a create: the file becomes a brand-new dataset.
  //
  // The body is multipart and read by the handler: declaring an input would
  // have the framework read it as JSON, and the file would be gone.
  service.registerRoute(
    "post",
    "/upload",
    MANAGEMENT_API_VERSION,
    async (c: DatasetContext) => {
      const project = projectOf(c);
      const application = app();

      const body = await c.req.parseBody();
      const file = body.file;
      const name = body.name;

      if (!name || typeof name !== "string" || name.trim() === "") {
        throw new UnprocessableEntityError("name field is required");
      }

      if (!file || !(file instanceof File)) {
        throw new UnprocessableEntityError("file field is required");
      }

      const content = await file.text();

      try {
        const result = await application.createDatasetFromUpload({
          projectId: project.id,
          name: name.trim(),
          filename: file.name,
          content,
          fileSize: file.size,
        });

        return c.json(result, 201);
      } catch (error) {
        if (error instanceof UploadValidationError) {
          if (error.kind === "file_too_large" || error.kind === "row_limit_exceeded") {
            throw new BadRequestError(error.message);
          }
          throw new UnprocessableEntityError(error.message);
        }
        if (error instanceof Error && error.name === "DatasetConflictError") {
          return c.json(
            {
              error: "Conflict",
              message: "A dataset with this slug already exists",
            },
            409,
          );
        }
        // Unsupported format from detectFileFormat
        if (error instanceof Error && error.message.includes("Unsupported file format")) {
          throw new UnprocessableEntityError(error.message);
        }
        throw error;
      }
    },
    (b) =>
      policy(requires("datasets:create"))(b)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({
          description: "Create a new dataset from an uploaded file (CSV, JSON, JSONL)",
        }),
  );

  // ── Direct (browser→S3) upload: request a presigned PUT ─────────
  // Registered before /:slugOrId so "direct-upload" isn't matched as a slug.
  // Session-cookie (or API-key) authenticated in-handler — see directUploadSessionAuth.
  service.registerRoute(
    "post",
    "/direct-upload",
    MANAGEMENT_API_VERSION,
    async (c: DatasetContext) => {
      const application = app();

      const body = await c.req.parseBody();
      const projectId = body.projectId;
      if (!projectId || typeof projectId !== "string" || projectId.trim() === "") {
        throw new UnprocessableEntityError("projectId field is required");
      }
      // Auth is in-handler (session cookie or API key) since there's no
      // `authMiddleware` to set `c.get("project")` for this route.
      const auth = await authorizeDirectUpload(c, projectId.trim());
      if (!auth.ok) {
        // `auth.body` is the full handled payload (code, meta, tips). Falling
        // back to `{ error }` keeps the shape for the failures that have no
        // handled error behind them.
        return c.json(auth.body ?? { error: auth.error }, auth.status);
      }

      const name = body.name;
      if (!name || typeof name !== "string" || name.trim() === "") {
        throw new UnprocessableEntityError("name field is required");
      }
      // M1: required — the staged object carries no original filename, so the
      // normalize job depends on this to detect the file format.
      const filename = body.filename;
      if (!filename || typeof filename !== "string" || filename.trim() === "") {
        throw new UnprocessableEntityError("filename field is required");
      }
      // ADR-032 v19: optional user-confirmed columns from the upload confirm step,
      // sent as a JSON string. The confirm UI sends the richer shape carrying each
      // column's immutable `sourceHeader` (so reorder + rename can't break the
      // header→column binding); legacy callers may send the bare name+type shape.
      // Prefer the confirm shape, fall back to legacy. A malformed value is
      // rejected rather than silently dropped (so a UI bug surfaces instead of
      // producing an all-`string` dataset). Absent → normalize derives as before.
      let columnTypes: DatasetConfirmColumns | DatasetColumns | undefined;
      if (body.columnTypes !== undefined) {
        // Present-but-invalid is rejected, never silently dropped (the contract).
        // Absent (undefined) is the only "no schema → derive" path.
        if (typeof body.columnTypes !== "string" || body.columnTypes.trim() === "") {
          throw new UnprocessableEntityError("columnTypes must be a non-empty JSON string");
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.columnTypes);
        } catch {
          throw new UnprocessableEntityError("columnTypes must be valid JSON");
        }
        const confirm = datasetConfirmColumnsSchema.safeParse(parsed);
        if (confirm.success) {
          columnTypes = confirm.data;
        } else {
          // Only a plainly legacy-shaped payload may fall back to positional
          // binding. Once any item carries `sourceHeader` the payload is from the
          // confirm flow, so a confirm parse failure is a real client bug — reject
          // it rather than downgrade to legacy (which would silently bind columns
          // by position and can persist the wrong column→data mapping).
          const looksLikeConfirmPayload =
            Array.isArray(parsed) &&
            parsed.some(
              (column) => column !== null && typeof column === "object" && "sourceHeader" in column,
            );
          if (looksLikeConfirmPayload) {
            throw new UnprocessableEntityError("columnTypes is malformed");
          }
          const legacy = datasetColumnsSchema.safeParse(parsed);
          if (!legacy.success) {
            throw new UnprocessableEntityError("columnTypes is malformed");
          }
          columnTypes = legacy.data;
        }
      }

      // Domain errors map centrally in the family's `onError` (see DOMAIN_ERROR_HTTP).
      // Note: DirectUploadUnavailableError (→ 409) is the client's signal to fall
      // back to the backend /upload path.
      const result = await application.createPendingUpload({
        projectId: auth.projectId,
        name: name.trim(),
        filename: filename.trim(),
        columnTypes,
      });
      return c.json(result, 201);
    },
    (b) =>
      policy(directUploadSessionAuth)(b)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({
          description: "Start a direct browser→S3 dataset upload (returns a presigned PUT)",
        }),
  );

  // ── Direct upload: stream the file into staging (no browser-reachable S3) ──
  // On S3 the browser PUTs the file to the bucket directly; only local FS routes
  // the bytes through the app, via the same-origin URL minted by
  // createPresignedUpload. Registered before the `/:datasetId` routes so "staging"
  // isn't matched as a datasetId. Session-cookie (or API-key) authed in-handler.
  //
  // The body is taken as a stream rather than through `withRawBody`, which
  // would buffer a heavy upload whole before the handler ever saw it.
  service.registerRoute(
    "put",
    "/direct-upload/staging/:uploadId",
    MANAGEMENT_API_VERSION,
    async (c: DatasetContext, input: z.infer<typeof uploadIdParamsSchema>) => {
      const { uploadId } = input;
      const projectId = c.req.query("projectId");
      if (!projectId || projectId.trim() === "") {
        throw new UnprocessableEntityError("projectId query param is required");
      }
      const auth = await authorizeDirectUpload(c, projectId.trim());
      if (!auth.ok) {
        // `auth.body` is the full handled payload (code, meta, tips). Falling
        // back to `{ error }` keeps the shape for the failures that have no
        // handled error behind them.
        return c.json(auth.body ?? { error: auth.error }, auth.status);
      }
      const body = c.req.raw.body;
      if (!body) {
        throw new UnprocessableEntityError("request body is required");
      }
      const application = app();
      // Domain errors map centrally in the family's `onError` (see DOMAIN_ERROR_HTTP).
      // Notes on the non-obvious ones: UploadNotPendingError (→ 409) means no
      // pending row owns this staging key (fabricated/replayed uploadId or already
      // finalized, an orphan write); StorageNotWritableError is handled
      // (`storage_not_writable`, 500, platform fault) and answers with its own
      // code, so the browser must NOT mistake it for "no object storage" and
      // fall back.
      await application.writeStagedUpload({
        projectId: auth.projectId,
        uploadId,
        // Web ReadableStream → Node Readable; streamed to disk, never buffered.
        body: Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
      });
      return c.json({ ok: true }, 200);
    },
    (b) =>
      policy(directUploadSessionAuth)(b)
        .withParams(uploadIdParamsSchema)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({
          description: "Stream a heavy upload into staging when there is no browser-reachable S3",
        }),
  );

  // ── Direct upload: finalize after the browser has PUT the file ───
  // Session-cookie (or API-key) authenticated in-handler — see directUploadSessionAuth.
  service.registerRoute(
    "post",
    "/direct-upload/:datasetId/finalize",
    MANAGEMENT_API_VERSION,
    async (c: DatasetContext, input: z.infer<typeof datasetIdParamsSchema>) => {
      const { datasetId } = input;
      const projectId = c.req.query("projectId");
      if (!projectId || projectId.trim() === "") {
        throw new UnprocessableEntityError("projectId query param is required");
      }
      const auth = await authorizeDirectUpload(c, projectId.trim());
      if (!auth.ok) {
        return c.json(auth.body ?? { error: auth.error }, auth.status);
      }
      const application = app();

      // The staging key is the server-minted one bound to the row (C1); the
      // client no longer supplies it. Domain errors map centrally in
      // `handleDatasetError` (see DOMAIN_ERROR_HTTP).
      const result = await application.finalizeUpload({
        projectId: auth.projectId,
        datasetId,
      });
      return c.json(result, 200);
    },
    (b) =>
      policy(directUploadSessionAuth)(b)
        .withParams(datasetIdParamsSchema)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({
          description: "Finalize a direct upload: size-check and start processing",
        }),
  );

  // ── Direct upload: manually retry a failed/stuck normalize (I-RECOVER) ──
  // Session-cookie (or API-key) authenticated in-handler — see directUploadSessionAuth.
  service.registerRoute(
    "post",
    "/direct-upload/:datasetId/retry",
    MANAGEMENT_API_VERSION,
    async (c: DatasetContext, input: z.infer<typeof datasetIdParamsSchema>) => {
      const { datasetId } = input;
      const projectId = c.req.query("projectId");
      if (!projectId || projectId.trim() === "") {
        throw new UnprocessableEntityError("projectId query param is required");
      }
      const auth = await authorizeDirectUpload(c, projectId.trim());
      if (!auth.ok) {
        return c.json(auth.body ?? { error: auth.error }, auth.status);
      }
      const application = app();

      // Domain errors map centrally in the family's `onError` (see DOMAIN_ERROR_HTTP).
      const result = await application.retryNormalize({
        projectId: auth.projectId,
        datasetId,
      });
      return c.json(result, 200);
    },
    (b) =>
      policy(directUploadSessionAuth)(b)
        .withParams(datasetIdParamsSchema)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({
          description: "Retry normalization of a failed or stuck dataset",
        }),
  );

  // ── Direct upload: abort a still-pending upload (CORS/network PUT failure) ──
  // Session-cookie (or API-key) authenticated in-handler — see directUploadSessionAuth.
  // Cleans up the orphaned `uploading` row so a failed presigned PUT isn't a dead
  // end before the browser falls back to the backend upload path.
  service.registerRoute(
    "delete",
    "/direct-upload/:datasetId",
    MANAGEMENT_API_VERSION,
    async (c: DatasetContext, input: z.infer<typeof datasetIdParamsSchema>) => {
      const { datasetId } = input;
      const projectId = c.req.query("projectId");
      if (!projectId || projectId.trim() === "") {
        throw new UnprocessableEntityError("projectId query param is required");
      }
      const auth = await authorizeDirectUpload(c, projectId.trim());
      if (!auth.ok) {
        return c.json(auth.body ?? { error: auth.error }, auth.status);
      }
      const application = app();

      // Domain errors map centrally in the family's `onError` (see DOMAIN_ERROR_HTTP).
      const result = await application.abortPendingUpload({
        projectId: auth.projectId,
        datasetId,
      });
      return c.json(result, 200);
    },
    (b) =>
      policy(directUploadSessionAuth)(b)
        .withParams(datasetIdParamsSchema)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({
          description: "Abort a still-pending direct upload and clean up its row",
        }),
  );

  // ── Upload File to Existing Dataset ─────────────────────────────
  // Appending rows to a dataset that already exists changes that dataset, so it
  // is an `:update`, not a create of anything the caller can name.
  service.registerRoute(
    "post",
    "/:slugOrId/upload",
    MANAGEMENT_API_VERSION,
    async (c: DatasetContext, input: z.infer<typeof slugOrIdParamsSchema>) => {
      const { slugOrId } = input;
      const project = projectOf(c);
      const application = app();

      const body = await c.req.parseBody();
      const file = body.file;

      if (!file || !(file instanceof File)) {
        throw new UnprocessableEntityError("file field is required");
      }

      const content = await file.text();

      try {
        const result = await application.uploadToExistingDataset({
          slugOrId,
          projectId: project.id,
          filename: file.name,
          content,
          fileSize: file.size,
        });

        return c.json(result);
      } catch (error) {
        if (error instanceof UploadValidationError) {
          if (
            error.kind === "file_too_large" ||
            error.kind === "row_limit_exceeded" ||
            error.kind === "column_mismatch"
          ) {
            throw new BadRequestError(error.message);
          }
          if (error.kind === "empty_file" || error.kind === "unsupported_format") {
            throw new UnprocessableEntityError(error.message);
          }
          throw new UnprocessableEntityError(error.message);
        }
        if (error instanceof Error && error.name === "DatasetNotFoundError") {
          throw new NotFoundError("Dataset not found");
        }
        // Unsupported format from detectFileFormat
        if (error instanceof Error && error.message.includes("Unsupported file format")) {
          throw new UnprocessableEntityError(error.message);
        }
        throw error;
      }
    },
    (b) =>
      policy(requires("datasets:update"))(b)
        .withParams(slugOrIdParamsSchema)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({
          description: "Upload a file (CSV, JSON, JSONL) to an existing dataset",
        }),
  );

  // ── Batch Create Records ──────────────────────────────────────
  // Rows live inside a dataset; adding them mutates that dataset — `:update`.
  service.registerRoute(
    "post",
    "/:slugOrId/records",
    MANAGEMENT_API_VERSION,
    async (
      c: DatasetContext,
      input: z.infer<typeof slugOrIdParamsSchema> & z.infer<typeof batchCreateRecordsSchema>,
    ) => {
      const { slugOrId, entries } = input;
      const project = projectOf(c);
      const application = app();

      try {
        const records = await application.batchCreateRecords({
          slugOrId,
          projectId: project.id,
          entries,
        });

        return c.json({ data: records }, 201);
      } catch (error) {
        if (error instanceof Error && error.name === "InvalidColumnError") {
          throw new BadRequestError(error.message);
        }
        if (error instanceof Error && error.name === "MalformedColumnTypesError") {
          throw new InternalServerError(error.message);
        }
        return mapDatasetNotFoundError(error);
      }
    },
    (b) =>
      policy(requires("datasets:update"))(b)
        .withParams(slugOrIdParamsSchema)
        .withInput(batchCreateRecordsSchema)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({ description: "Create records in a dataset in batch" }),
  );

  // ── Legacy: Add Entries ────────────────────────────────────────
  // The legacy spelling of the batch-records route above; same grain.
  service.registerRoute(
    "post",
    "/:slug/entries",
    MANAGEMENT_API_VERSION,
    async (
      c: DatasetContext,
      input: z.infer<typeof slugParamsSchema> & z.infer<typeof legacyEntriesSchema>,
    ) => {
      const { slug, entries } = input;
      const project = projectOf(c);
      const application = app();

      // Route through the service (parity with `/:slugOrId/records`) instead of
      // reaching into the tRPC-layer `createManyDatasetRecords` util: the service
      // owns the dataset lookup, column validation, id generation, and the
      // s3_jsonl-vs-PG write routing. This handler only translates the result and
      // typed errors to the legacy `{ success }` HTTP shape.
      try {
        await application.batchCreateRecords({
          slugOrId: slug,
          projectId: project.id,
          entries,
        });
        return c.json({ success: true });
      } catch (error) {
        if (error instanceof Error && error.name === "InvalidColumnError") {
          throw new BadRequestError(error.message);
        }
        if (error instanceof Error && error.name === "MalformedColumnTypesError") {
          throw new InternalServerError(error.message);
        }
        // M1: an s3_jsonl dataset still preparing rejects the append (I-READY).
        const notReady = mapDatasetNotReadyError(error, c);
        if (notReady) return notReady;
        return mapDatasetNotFoundError(error);
      }
    },
    (b) =>
      policy(requires("datasets:update"))(b)
        .withParams(slugParamsSchema)
        .withInput(legacyEntriesSchema)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({ description: "Add entries to a dataset" }),
  );

  // ── Get Single Dataset ─────────────────────────────────────────
  service.registerRoute(
    "get",
    "/:slugOrId",
    MANAGEMENT_API_VERSION,
    async (c: DatasetContext, input: z.infer<typeof slugOrIdParamsSchema>) => {
      const { slugOrId } = input;
      if (!slugOrId) {
        throw new UnprocessableEntityError("Dataset slug or id is required");
      }

      const project = projectOf(c);
      const application = app();

      let result;
      try {
        result = await application.getDatasetWithRecords({
          slugOrId,
          projectId: project.id,
          limitMb: MAX_LIMIT_MB,
        });
      } catch (error) {
        const notReady = mapDatasetNotReadyError(error, c);
        if (notReady) return notReady;
        return mapDatasetNotFoundError(error);
      }

      const { dataset, records, truncated } = result;
      if (truncated) {
        throw new BadRequestError(`Dataset size exceeds ${MAX_LIMIT_MB}MB limit`);
      }

      return c.json({
        id: dataset.id,
        name: dataset.name,
        slug: dataset.slug,
        columnTypes: dataset.columnTypes,
        createdAt: dataset.createdAt,
        updatedAt: dataset.updatedAt,
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/datasets/${dataset.id}`,
        }),
        data: records,
      });
    },
    (b) =>
      policy(requires("datasets:view"))(b)
        .withParams(slugOrIdParamsSchema)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({
          description: "Get a dataset by its slug or id.",
          responses: {
            ...baseResponses,
            200: buildStandardSuccessResponse(datasetOutputSchema),
            404: {
              description: "Dataset not found",
              content: {
                "application/json": { schema: resolver(errorSchema) },
              },
            },
          },
        }),
  );

  // ── Update Dataset ─────────────────────────────────────────────
  // `:manage`, not `:update`. A change to the column KEY SET makes this a
  // migration rather than an edit: `upsertDataset` rewrites every record onto the
  // new set (`migrateS3JsonlColumns` / `migrateDatasetRecordColumns`), so the
  // shape of the whole dataset follows the payload. That is administering a
  // dataset, which is what `:manage` names. The tRPC `dataset.upsert` procedure
  // calls the same application operation and asks for the same grain; the two
  // surfaces describing one operation differently is what this sweep set out to
  // remove.
  service.registerRoute(
    "patch",
    "/:slugOrId",
    MANAGEMENT_API_VERSION,
    async (
      c: DatasetContext,
      input: z.infer<typeof slugOrIdParamsSchema> & z.infer<typeof updateDatasetSchema>,
    ) => {
      const { slugOrId, name, columnTypes } = input;
      const project = projectOf(c);
      const application = app();

      try {
        // Naming the dataset by slug is enough: the application resolves it and
        // takes the name and columns this patch did not send from the row it is
        // replacing. That fill used to live here, in a lookup-then-default pair
        // this handler ran for itself, while the tRPC upsert filled the same
        // hole from an experiment. One upsert now decides both.
        const updated = await application.upsertDataset({
          projectId: project.id,
          slugOrId,
          name,
          columnTypes: columnTypes as DatasetColumns | undefined,
        });

        return c.json({
          id: updated.id,
          name: updated.name,
          slug: updated.slug,
          columnTypes: updated.columnTypes,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/datasets/${updated.id}`,
          }),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "DatasetConflictError") {
          return c.json(
            {
              error: "Conflict",
              message: "A dataset with this slug already exists",
            },
            409,
          );
        }
        if (error instanceof Error && error.name === "DatasetNotFoundError") {
          throw new NotFoundError("Dataset not found");
        }
        throw error;
      }
    },
    (b) =>
      policy(requires("datasets:manage"))(b)
        .withParams(slugOrIdParamsSchema)
        .withInput(updateDatasetSchema)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({ description: "Update a dataset by its slug or id" }),
  );

  // ── Delete (Archive) Dataset ───────────────────────────────────
  // Destruction deliberately stays at `:manage` — it is the only grain that
  // carries it, and a read-and-write credential must not inherit it.
  service.registerRoute(
    "delete",
    "/:slugOrId",
    MANAGEMENT_API_VERSION,
    async (c: DatasetContext, input: z.infer<typeof slugOrIdParamsSchema>) => {
      const { slugOrId } = input;
      const project = projectOf(c);
      const application = app();

      try {
        const result = await application.archiveDataset({
          slugOrId,
          projectId: project.id,
        });
        return c.json(result);
      } catch (error) {
        return mapDatasetNotFoundError(error);
      }
    },
    (b) =>
      policy(requires("datasets:manage"))(b)
        .withParams(slugOrIdParamsSchema)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({ description: "Archive a dataset (soft-delete)" }),
  );

  // ── List Records (paginated) ───────────────────────────────────
  service.registerRoute(
    "get",
    "/:slugOrId/records",
    MANAGEMENT_API_VERSION,
    async (
      c: DatasetContext,
      input: z.infer<typeof slugOrIdParamsSchema> & z.infer<typeof paginationQuerySchema>,
    ) => {
      const { slugOrId, page, limit } = input;
      const project = projectOf(c);
      const application = app();

      try {
        const result = await application.listRecords({
          slugOrId,
          projectId: project.id,
          page,
          limit,
        });
        return c.json(result);
      } catch (error) {
        const notReady = mapDatasetNotReadyError(error, c);
        if (notReady) return notReady;
        return mapDatasetNotFoundError(error);
      }
    },
    (b) =>
      policy(requires("datasets:view"))(b)
        .withParams(slugOrIdParamsSchema)
        .withQuery(paginationQuerySchema)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({ description: "List records for a dataset (paginated)" }),
  );

  // ── Update / Upsert Record ─────────────────────────────────────
  service.registerRoute(
    "patch",
    "/:slugOrId/records/:recordId",
    MANAGEMENT_API_VERSION,
    async (
      c: DatasetContext,
      input: z.infer<typeof recordParamsSchema> & z.infer<typeof updateRecordSchema>,
    ) => {
      const { slugOrId, recordId, entry } = input;
      const project = projectOf(c);
      const application = app();

      try {
        const { record, created } = await application.upsertRecord({
          slugOrId,
          projectId: project.id,
          recordId,
          updatedRecord: entry,
        });

        return c.json(record, created ? 201 : 200);
      } catch (error) {
        // M1: a still-preparing s3_jsonl dataset rejects the upsert (I-READY) → 425.
        const notReady = mapDatasetNotReadyError(error, c);
        if (notReady) return notReady;
        return mapDatasetNotFoundError(error);
      }
    },
    (b) =>
      policy(requires("datasets:update"))(b)
        .withParams(recordParamsSchema)
        .withInput(updateRecordSchema)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({ description: "Update or create a record in a dataset" }),
  );

  // ── Batch Delete Records ───────────────────────────────────────
  // Destructive — stays at `:manage`, like the dataset archive above.
  service.registerRoute(
    "delete",
    "/:slugOrId/records",
    MANAGEMENT_API_VERSION,
    async (
      c: DatasetContext,
      input: z.infer<typeof slugOrIdParamsSchema> & z.infer<typeof deleteRecordsSchema>,
    ) => {
      const { slugOrId, recordIds } = input;
      const project = projectOf(c);
      const application = app();

      let result;
      try {
        result = await application.deleteRecords({
          slugOrId,
          projectId: project.id,
          recordIds,
        });
      } catch (error) {
        // M1: a still-preparing s3_jsonl dataset rejects the delete (I-READY) → 425.
        const notReady = mapDatasetNotReadyError(error, c);
        if (notReady) return notReady;
        return mapDatasetNotFoundError(error);
      }

      if (result.count === 0) {
        throw new NotFoundError("No matching records found");
      }

      return c.json({ deletedCount: result.count });
    },
    (b) =>
      policy(requires("datasets:manage"))(b)
        .withParams(slugOrIdParamsSchema)
        .withInput(deleteRecordsSchema)
        .withRawResponse(DATASET_ANSWER_REASON, { contentType: "application/json" })
        .withDocs({ description: "Delete records from a dataset by IDs" }),
  );

  return service.build();
}
