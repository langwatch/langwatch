/**
 * Public Hono REST API for datasets.
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
  type AppRestProjectVariables,
  type AppRestSecurity,
  BadRequestError,
  baseResponses,
  buildStandardSuccessResponse,
  errorSchema,
  InternalServerError,
  NotFoundError,
  type PlatformUrlBuilder,
  type SecuredApp,
  UnprocessableEntityError,
  validator as zValidator,
} from "@langwatch/api/rest";
import {
  datasetColumnsSchema,
  datasetColumnTypeSchema,
  datasetConfirmColumnsSchema,
  type DatasetColumns,
  type DatasetConfirmColumns,
  type DatasetNotReadyError,
  UploadValidationError,
} from "@langwatch/dataset-contract";
import type { Context } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import type { DatasetApp } from "#app/dataset.app";
import { createDatasetErrorHandler } from "./dataset.error-handler";
import { datasetOutputSchema } from "./dataset.schemas";

/**
 * The read ceiling for `GET /api/dataset/:slugOrId`, which answers with the
 * whole dataset inline. A dataset above it is refused rather than truncated.
 */
const MAX_LIMIT_MB = 25;

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
  c: Context,
  projectId: string,
) => Promise<DatasetDirectUploadAuthorization>;

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
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, app, platformUrl, authorizeDirectUpload } = options;

  const secured = security.createProjectApp({
    basePath: "/api/dataset",
  });

  // Preserve the dataset-specific error mapping (domain errors → HTTP codes).
  secured.hono.onError(
    createDatasetErrorHandler({ boundaryErrorHandler: security.legacyErrorHandler }),
  );

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
  secured.access(requires("datasets:view")).get(
    "/",
    describeRoute({
      description: "List all non-archived datasets for the project (paginated)",
    }),
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const project = c.get("project");
      const { page, limit } = c.req.valid("query");
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
  );

  // ── Create Dataset ─────────────────────────────────────────────
  // Creating asks for `datasets:create`, not `datasets:manage`. `:manage` still
  // implies `:create` through the RBAC hierarchy, so every role and key that
  // could create a dataset yesterday still can — what changes is that a
  // credential the product issues at the CREATE grain is honoured instead of
  // refused. A viewer holds only `datasets:view` and is declined as before.
  secured.access(requires("datasets:create")).post(
    "/",
    describeRoute({
      description: "Create a new dataset",
    }),
    zValidator("json", createDatasetSchema),
    async (c) => {
      const project = c.get("project");
      const { name, columnTypes } = c.req.valid("json");
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
  );

  // ── Create + Upload Dataset from File ─────────────────────────
  // IMPORTANT: This route MUST be registered BEFORE /:slugOrId routes
  // so Hono doesn't match "upload" as a slugOrId parameter.
  // Also a create: the file becomes a brand-new dataset.
  secured.access(requires("datasets:create")).post(
    "/upload",
    describeRoute({
      description: "Create a new dataset from an uploaded file (CSV, JSON, JSONL)",
    }),
    async (c) => {
      const project = c.get("project");
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
  );

  // ── Direct (browser→S3) upload: request a presigned PUT ─────────
  // Registered before /:slugOrId so "direct-upload" isn't matched as a slug.
  // Session-cookie (or API-key) authenticated in-handler — see directUploadSessionAuth.
  secured.access(directUploadSessionAuth).post(
    "/direct-upload",
    describeRoute({
      description: "Start a direct browser→S3 dataset upload (returns a presigned PUT)",
    }),
    async (c) => {
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
  );

  // ── Direct upload: stream the file into staging (no browser-reachable S3) ──
  // On S3 the browser PUTs the file to the bucket directly; only local FS routes
  // the bytes through the app, via the same-origin URL minted by
  // createPresignedUpload. Registered before the `/:datasetId` routes so "staging"
  // isn't matched as a datasetId. Session-cookie (or API-key) authed in-handler.
  secured.access(directUploadSessionAuth).put(
    "/direct-upload/staging/:uploadId",
    describeRoute({
      description: "Stream a heavy upload into staging when there is no browser-reachable S3",
    }),
    async (c) => {
      const { uploadId } = c.req.param();
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
  );

  // ── Direct upload: finalize after the browser has PUT the file ───
  // Session-cookie (or API-key) authenticated in-handler — see directUploadSessionAuth.
  secured.access(directUploadSessionAuth).post(
    "/direct-upload/:datasetId/finalize",
    describeRoute({
      description: "Finalize a direct upload: size-check and start processing",
    }),
    async (c) => {
      const { datasetId } = c.req.param();
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
  );

  // ── Direct upload: manually retry a failed/stuck normalize (I-RECOVER) ──
  // Session-cookie (or API-key) authenticated in-handler — see directUploadSessionAuth.
  secured.access(directUploadSessionAuth).post(
    "/direct-upload/:datasetId/retry",
    describeRoute({
      description: "Retry normalization of a failed or stuck dataset",
    }),
    async (c) => {
      const { datasetId } = c.req.param();
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
      const application = app();

      // Domain errors map centrally in the family's `onError` (see DOMAIN_ERROR_HTTP).
      const result = await application.retryNormalize({
        projectId: auth.projectId,
        datasetId,
      });
      return c.json(result, 200);
    },
  );

  // ── Direct upload: abort a still-pending upload (CORS/network PUT failure) ──
  // Session-cookie (or API-key) authenticated in-handler — see directUploadSessionAuth.
  // Cleans up the orphaned `uploading` row so a failed presigned PUT isn't a dead
  // end before the browser falls back to the backend upload path.
  secured.access(directUploadSessionAuth).delete(
    "/direct-upload/:datasetId",
    describeRoute({
      description: "Abort a still-pending direct upload and clean up its row",
    }),
    async (c) => {
      const { datasetId } = c.req.param();
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
      const application = app();

      // Domain errors map centrally in the family's `onError` (see DOMAIN_ERROR_HTTP).
      const result = await application.abortPendingUpload({
        projectId: auth.projectId,
        datasetId,
      });
      return c.json(result, 200);
    },
  );

  // ── Upload File to Existing Dataset ─────────────────────────────
  // Appending rows to a dataset that already exists changes that dataset, so it
  // is an `:update`, not a create of anything the caller can name.
  secured.access(requires("datasets:update")).post(
    "/:slugOrId/upload",
    describeRoute({
      description: "Upload a file (CSV, JSON, JSONL) to an existing dataset",
    }),
    async (c) => {
      const { slugOrId } = c.req.param();
      const project = c.get("project");
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
  );

  // ── Batch Create Records ──────────────────────────────────────
  // Rows live inside a dataset; adding them mutates that dataset — `:update`.
  secured.access(requires("datasets:update")).post(
    "/:slugOrId/records",
    describeRoute({
      description: "Create records in a dataset in batch",
    }),
    zValidator("json", batchCreateRecordsSchema),
    async (c) => {
      const { slugOrId } = c.req.param();
      const project = c.get("project");
      const { entries } = c.req.valid("json");
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
  );

  // ── Legacy: Add Entries ────────────────────────────────────────
  // The legacy spelling of the batch-records route above; same grain.
  secured.access(requires("datasets:update")).post(
    "/:slug/entries",
    describeRoute({
      description: "Add entries to a dataset",
    }),
    zValidator(
      "json",
      z
        .object({
          entries: z
            .array(z.record(z.string(), z.any()))
            .meta({
              example: [
                {
                  input: "hi",
                  output: "Hello, how can I help you today?",
                },
              ],
            }),
        })
        .meta({ id: "DatasetPostEntries" }),
    ),
    async (c) => {
      const { slug } = c.req.param();
      const project = c.get("project");
      const { entries } = c.req.valid("json");
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
  );

  // ── Get Single Dataset ─────────────────────────────────────────
  secured.access(requires("datasets:view")).get(
    "/:slugOrId",
    describeRoute({
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
    async (c) => {
      const { slugOrId } = c.req.param();
      if (!slugOrId) {
        throw new UnprocessableEntityError("Dataset slug or id is required");
      }

      const project = c.get("project");
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
  secured.access(requires("datasets:manage")).patch(
    "/:slugOrId",
    describeRoute({
      description: "Update a dataset by its slug or id",
    }),
    zValidator("json", updateDatasetSchema),
    async (c) => {
      const { slugOrId } = c.req.param();
      const project = c.get("project");
      const body = c.req.valid("json");
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
          name: body.name,
          columnTypes: body.columnTypes as DatasetColumns | undefined,
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
  );

  // ── Delete (Archive) Dataset ───────────────────────────────────
  // Destruction deliberately stays at `:manage` — it is the only grain that
  // carries it, and a read-and-write credential must not inherit it.
  secured.access(requires("datasets:manage")).delete(
    "/:slugOrId",
    describeRoute({
      description: "Archive a dataset (soft-delete)",
    }),
    async (c) => {
      const { slugOrId } = c.req.param();
      const project = c.get("project");
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
  );

  // ── List Records (paginated) ───────────────────────────────────
  secured.access(requires("datasets:view")).get(
    "/:slugOrId/records",
    describeRoute({
      description: "List records for a dataset (paginated)",
    }),
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const { slugOrId } = c.req.param();
      const project = c.get("project");
      const { page, limit } = c.req.valid("query");
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
  );

  // ── Update / Upsert Record ─────────────────────────────────────
  secured.access(requires("datasets:update")).patch(
    "/:slugOrId/records/:recordId",
    describeRoute({
      description: "Update or create a record in a dataset",
    }),
    zValidator("json", updateRecordSchema),
    async (c) => {
      const { slugOrId, recordId } = c.req.param();
      const project = c.get("project");
      const { entry } = c.req.valid("json");
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
  );

  // ── Batch Delete Records ───────────────────────────────────────
  // Destructive — stays at `:manage`, like the dataset archive above.
  secured.access(requires("datasets:manage")).delete(
    "/:slugOrId/records",
    describeRoute({
      description: "Delete records from a dataset by IDs",
    }),
    zValidator("json", deleteRecordsSchema),
    async (c) => {
      const { slugOrId } = c.req.param();
      const project = c.get("project");
      const { recordIds } = c.req.valid("json");
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
  );

  return secured;
}
