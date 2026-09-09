/**
 * `/api/files` — the bytes of one stored object, for the page that renders it
 * and for the project key that fetches it. An object is addressed by its id,
 * so the owning project is resolved in the handler, not by the door.
 */
import { Readable } from "node:stream";
import { deferredScope } from "@langwatch/api/access";
import {
  defineRestRouter,
  jsonResponse,
  MANAGEMENT_API_VERSION,
  rateLimitedResponse,
  safeMediaType,
  sanitizeFilenameSegment,
  STORED_OBJECT_RESPONSE_BASE_HEADERS,
  type RestRawResult,
} from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/runtime-composition";
import {
  isReadbackSafe,
  StoredObjectOwnerLookupUnavailableError,
} from "@langwatch/stored-object-contract";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { StoredObjectFileStreamRead } from "#app/stored-object.app";

/** Per-caller rate limit on the read routes. */
const FILES_RATE_LIMIT_WINDOW_SECONDS = 60;
const FILES_RATE_LIMIT_MAX = 120;

/**
 * Stored objects are shared by several features, and which permission guards a
 * read depends on what the object IS: trace media requires `traces:view`,
 * scenario media `scenarios:view`, and a custom role can hold either alone.
 */
export const FILE_VIEW_PERMISSIONS = ["traces:view", "scenarios:view"] as const;

/** The permission an object of one purpose is read behind. */
export type StoredObjectFileViewPermission = (typeof FILE_VIEW_PERMISSIONS)[number];

export function requiredPermissionForPurpose(purpose: string): StoredObjectFileViewPermission {
  return purpose === "trace_content" ? "traces:view" : "scenarios:view";
}

/** The codes the permission check raises when it refuses the caller. */
const DENIAL_CODES: ReadonlySet<string> = new Set([
  "project_permission_denied",
  "lite_member_restricted",
  // The ADR-092 engine's denial. A route that has migrated to
  // `authz.authorize()` throws this instead of the legacy pair, and without
  // it here the engine's 403 would surface as a 500.
  "permission_denied",
]);

/**
 * True only for the denial shapes the permission check documents. Anything
 * else — a dropped database connection, a Prisma fault — is an infrastructure
 * failure that must bubble up as a 5xx, never be masked as a 403.
 */
export function isPermissionDenial(err: unknown): boolean {
  return HandledError.isHandled(err) && DENIAL_CODES.has(err.code);
}

/**
 * Refuses the read unless `userId` holds `permission` on `projectId`.
 */
export type FilesProjectPermissionCheck = (args: {
  userId: string;
  projectId: string;
  permission: StoredObjectFileViewPermission;
}) => Promise<void>;

/** A fixed-window counter, keyed on the caller. */
export type FilesRateLimiter = (args: {
  key: string;
  windowSeconds: number;
  max: number;
}) => Promise<{ allowed: boolean; resetAt: number }>;

/**
 * Who the deployment's dual-credential verifier let in. The key's own ceiling
 * travels with it, so both gates below ask the credential this request
 * actually carried.
 */
export type StoredObjectFileCaller = Readonly<{
  apiKeyProjectId?: string | undefined;
  userId?: string | undefined;
  apiKeyCeiling?: ((permission: AuthzPermission) => Promise<void>) | undefined;
}>;

/** What one count of a caller's reads answers. */
export type StoredObjectFileAllowance = Readonly<{ allowed: boolean; resetAt: number }>;

/**
 * What the byte door reaches. The verifier, the counter and the person's
 * project permission belong to the DEPLOYMENT; the two reads belong to this
 * module. The family asks all five in the order its handler fixes.
 */
export interface StoredObjectFileApi {
  /** Who this request presents, as the process's own verifier resolved it. */
  identify(input: { request: Request }): Promise<StoredObjectFileCaller>;
  countRead(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<StoredObjectFileAllowance>;
  requireProjectPermission(input: {
    userId: string;
    projectId: string;
    permission: StoredObjectFileViewPermission;
  }): Promise<void>;
  /** Which project owns an object, for a URL that does not say. */
  resolveOwner(input: { id: string }): Promise<{ projectId: string } | null>;
  /** One object's row and, when the bytes are there, a stream of them. */
  readById(input: { projectId: string; id: string }): Promise<StoredObjectFileStreamRead | null>;
}

export const StoredObjectFileApi = moduleApi<StoredObjectFileApi>("stored-object");

/**
 * The `Content-Disposition` filename a caller may ask for. Optional, so a
 * request naming none answers the object's own id rather than a refusal.
 */
const filenameQuery = z.object({ filename: z.string().optional() });

const OWNER_RESOLVED_IN_HANDLER =
  "an object is addressed by its id, so the project that owns it is a read this handler " +
  "makes; the caller is then authorized against the owner it found";

/**
 * The object's own media type where the readback allowlist admits it, and
 * `application/octet-stream` where it does not.
 */
const SERVED_MEDIA_TYPES = "*/*";

/**
 * `/api/files/:projectId/:id` (issue #4947) and the id-only URL minted before
 * it, at exactly the addresses they have always answered. Literal because the
 * two differ in shape rather than in vintage.
 */
export const storedObjectFileRest = defineRestRouter(StoredObjectFileApi)
  .withNamespace("files")
  .withVersion(MANAGEMENT_API_VERSION)
  // The browser's own door: an `<img>` or `<audio>` fires with a cookie and no
  // headers, so no API client can present what opens this family and it
  // publishes no operation. A project API key opens the SAME door.
  .withCredential("session")
  .withAddressing("literal", { v1Twin: true })

  .get("/api/files/:projectId/:id", "readProjectStoredObjectBytes")
  .withParams(z.object({ projectId: z.string(), id: z.string() }))
  .withQuery(filenameQuery)
  .withAccess(deferredScope({ reason: OWNER_RESOLVED_IN_HANDLER }))
  .withRawResponse({ produces: SERVED_MEDIA_TYPES })
  .methods(["GET", "HEAD"])
  .handle(async ({ app, input, request }) =>
    serveStoredObjectBytes({
      app,
      request,
      id: input.id,
      claimedProjectId: input.projectId,
      requestedFilename: input.filename,
    }),
  )

  .get("/api/files/:id", "readStoredObjectBytes")
  .withParams(z.object({ id: z.string() }))
  .withQuery(filenameQuery)
  .withAccess(deferredScope({ reason: OWNER_RESOLVED_IN_HANDLER }))
  .withRawResponse({ produces: SERVED_MEDIA_TYPES })
  .methods(["GET", "HEAD"])
  .handle(async ({ app, input, request }) =>
    serveStoredObjectBytes({ app, request, id: input.id, requestedFilename: input.filename }),
  )
  .build();

/**
 * Count the caller, resolve the owner, admit the caller to that project, read
 * the row, then hold the caller to the permission the object's purpose maps
 * to. The order is the family's whole security argument.
 */
async function serveStoredObjectBytes({
  app,
  request,
  id,
  claimedProjectId,
  requestedFilename,
}: {
  app: StoredObjectFileApi;
  request: Request;
  id: string;
  claimedProjectId?: string | undefined;
  requestedFilename?: string | undefined;
}): Promise<RestRawResult> {
  const caller = await app.identify({ request });
  const allowance = await countCaller({ app, caller });

  if (!allowance.allowed) return rateLimitedResponse(allowance.resetAt);

  const owner = await ownerOf({ app, id, claimedProjectId });

  if (!owner) return jsonResponse({ status: "not_found" }, 404);
  if (owner.unavailable) return unavailable();

  // Pinned once: the gate below and the read after it MUST use the same value,
  // or a future edit could authorize one project and read another.
  const ownerProjectId = owner.projectId;

  await authorizeFileRead({ app, caller, ownerProjectId });

  const result = await readOf({ app, ownerProjectId, id });

  if (!result) return jsonResponse({ status: "not_found" }, 404);
  if (!("row" in result)) return unavailable();

  await authorizeFilePurpose({ app, caller, ownerProjectId, purpose: result.row.purpose });

  if (!("stream" in result)) return jsonResponse({ status: "missing" }, 404);

  return bytesOf({ row: result.row, stream: result.stream, requestedFilename });
}

/**
 * Keyed on the caller's own identity so id probes are throttled BEFORE the
 * shared cross-tenant lookup; keying on the owner project would need that
 * lookup first, which is the fan-out this counter exists to stop.
 */
async function countCaller({
  app,
  caller,
}: {
  app: StoredObjectFileApi;
  caller: StoredObjectFileCaller;
}): Promise<StoredObjectFileAllowance> {
  const key = caller.apiKeyProjectId ?? caller.userId;

  // The verifier sets one of the two on every request it admits; reaching here
  // with neither means a future edit broke that contract. Refuse rather than
  // fall back to a shared bucket every caller would share.
  if (!key) throw new HTTPException(500, { message: "rate-limit key unresolved" });

  return app.countRead({
    key: `files-route:caller:${key}`,
    windowSeconds: FILES_RATE_LIMIT_WINDOW_SECONDS,
    max: FILES_RATE_LIMIT_MAX,
  });
}

/** A degraded instance must not read as a deleted object. */
type ResolvedOwner =
  | Readonly<{ projectId: string; unavailable?: undefined }>
  | Readonly<{ projectId?: undefined; unavailable: true }>;

/**
 * The project-scoped URL carries the claimed owner, so it is taken directly:
 * the gate refuses a foreign claim and the scoped read answers 404 for one
 * owning no row. The id-only URL falls back to the cross-tenant lookup.
 */
async function ownerOf({
  app,
  id,
  claimedProjectId,
}: {
  app: StoredObjectFileApi;
  id: string;
  claimedProjectId?: string | undefined;
}): Promise<ResolvedOwner | null> {
  if (claimedProjectId) return { projectId: claimedProjectId };

  try {
    const owner = await app.resolveOwner({ id });

    return owner ? { projectId: owner.projectId } : null;
  } catch (err) {
    if (err instanceof StoredObjectOwnerLookupUnavailableError) return { unavailable: true };

    throw err;
  }
}

/** A storage failure other than a miss is an outage, not a deletion. */
async function readOf({
  app,
  ownerProjectId,
  id,
}: {
  app: StoredObjectFileApi;
  ownerProjectId: string;
  id: string;
}): Promise<StoredObjectFileStreamRead | { unavailable: true } | null> {
  try {
    return await app.readById({ projectId: ownerProjectId, id });
  } catch {
    return { unavailable: true };
  }
}

/**
 * Whether the caller may read objects owned by `ownerProjectId` AT ALL. The
 * purpose is not known yet, so ANY of the file-view permissions admits; a key
 * is pinned to the project it resolved to AND capped by its own ceiling.
 */
async function authorizeFileRead({
  app,
  caller,
  ownerProjectId,
}: {
  app: StoredObjectFileApi;
  caller: StoredObjectFileCaller;
  ownerProjectId: string;
}): Promise<void> {
  if (caller.apiKeyProjectId) {
    if (caller.apiKeyProjectId !== ownerProjectId) {
      throw new HTTPException(403, { message: "forbidden" });
    }

    return enforceAnyOf(ceilingOf(caller), FILE_VIEW_PERMISSIONS);
  }

  const userId = caller.userId;

  if (!userId) throw new HTTPException(401, { message: "unauthenticated" });

  for (const permission of FILE_VIEW_PERMISSIONS) {
    try {
      await app.requireProjectPermission({ userId, projectId: ownerProjectId, permission });

      return;
    } catch (err) {
      if (!isPermissionDenial(err)) throw err;
    }
  }

  throw new HTTPException(403, { message: "forbidden" });
}

/**
 * The permission the object's purpose maps to, asked once the row is known. A
 * caller admitted on either category alone would otherwise read media of the
 * category it does not hold.
 */
async function authorizeFilePurpose({
  app,
  caller,
  ownerProjectId,
  purpose,
}: {
  app: StoredObjectFileApi;
  caller: StoredObjectFileCaller;
  ownerProjectId: string;
  purpose: string;
}): Promise<void> {
  const permission = requiredPermissionForPurpose(purpose);

  // The key's own refusal, with its own code — the shape `authorizeFileRead`
  // already lets through.
  if (caller.apiKeyProjectId) return ceilingOf(caller)(permission);

  const userId = caller.userId;

  if (!userId) return;

  try {
    await app.requireProjectPermission({ userId, projectId: ownerProjectId, permission });
  } catch (err) {
    if (!isPermissionDenial(err)) throw err;

    throw new HTTPException(403, { message: "forbidden" });
  }
}

/**
 * The verifier sets a ceiling on every key it resolves; reaching here without
 * one means that contract broke. Refuse rather than read.
 */
function ceilingOf(caller: StoredObjectFileCaller): (permission: AuthzPermission) => Promise<void> {
  const ceiling = caller.apiKeyCeiling;

  if (!ceiling) throw new HTTPException(500, { message: "api key ceiling unresolved" });

  return ceiling;
}

/** The key's ceiling, satisfied by ANY of the permissions a file read can need. */
async function enforceAnyOf(
  ceiling: (permission: AuthzPermission) => Promise<void>,
  permissions: readonly AuthzPermission[],
): Promise<void> {
  let refusal: unknown;

  for (const permission of permissions) {
    try {
      await ceiling(permission);

      return;
    } catch (err) {
      if (!HandledError.isHandled(err)) throw err;

      refusal = err;
    }
  }

  throw refusal;
}

/** The one sentence every transient byte failure answers with. */
function unavailable(): Response {
  return jsonResponse({ error: "file temporarily unavailable" }, 502);
}

/**
 * The 200: the safe media type, the stored length, the sanitised filename and
 * the hardening headers every byte door carries. A HEAD request is answered
 * from this route, and the runtime cancels the stream it does not send.
 */
function bytesOf({
  row,
  stream,
  requestedFilename,
}: {
  row: { id: string; size_bytes: number; media_type: string };
  stream: Readable;
  requestedFilename?: string | undefined;
}): RestRawResult {
  const filename =
    (requestedFilename ? sanitizeFilenameSegment(requestedFilename) : "") ||
    sanitizeFilenameSegment(row.id);

  return {
    status: 200,
    headers: {
      "Content-Type": safeMediaType({ mediaType: row.media_type, readbackSafe: isReadbackSafe }),
      "Content-Length": String(row.size_bytes),
      "Content-Disposition": `inline; filename="${filename}"`,
      ...STORED_OBJECT_RESPONSE_BASE_HEADERS,
    },
    body: Readable.toWeb(stream) as ReadableStream,
  };
}
