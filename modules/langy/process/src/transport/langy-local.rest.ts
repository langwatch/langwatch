/**
 * The worker's door onto the developer's folder (ADR-129), deliberately NOT
 * under `/api/internal`. Every refusal is a `HandledError`: the worker's
 * stderr is `/dev/null`, so the HTTP answer is all it has.
 */

import { PayloadTooLargeError } from "@langwatch/api";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import {
  LangyApi,
  LangyApiRequestInvalidError,
  langyLocalCallIdParamsSchema,
  langyLocalCreateRequestBodySchema,
  langyLocalStartCallRequestSchema,
  langyLocalStartWaitRequestSchema,
  langyLocalWorkspaceQuerySchema,
} from "@langwatch/langy-contract";
import type { z } from "zod";

/** A local call is a small JSON document, never an upload. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * The permission this door declares AND the one it enforces. One constant, so
 * the declaration the OpenAPI surface publishes and the check the framework
 * runs cannot drift into disagreeing about what a caller needs.
 */
const LOCAL_PERMISSION = "langy:create" as const;

/** The worker's own wire: the key's owner is read off the request's credential. */
const LOCAL_ANSWER = {
  produces: "application/json",
  because: "The local worker's identity bridge reads the key's owner off the project credential.",
} as const;

/** The operation's answer as the worker reads it. */
function localJson(body: unknown) {
  return { status: 200, mediaType: "application/json", body: JSON.stringify(body) } as const;
}

/** Parses and validates a JSON body a composed schema can't declare via `.withInput()`. */
function parseJsonBody<T extends z.ZodType>(raw: string, schema: T): z.infer<T> {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new LangyApiRequestInvalidError(parsed.error.issues);
  return parsed.data;
}

export const langyLocalRest = defineRestRouter(LangyApi)
  .withNamespace("langy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("project")
  .withAddressing("literal", { v1Twin: false })

  // ── what `code_access` reads ──────────────────────────────────────────────

  .get("/api/langy/local/workspace", "langyLocalWorkspace")
  .withPermission(LOCAL_PERMISSION)
  .withQuery(langyLocalWorkspaceQuerySchema)
  .withResponse("protocol", LOCAL_ANSWER)
  .withDocs({
    description: "The code access card's own status document, as the command line reads it.",
  })
  .handle(async ({ app, input, request, response }) =>
    response.write(
      localJson(
        await app.getLocalWorkspace({
          credential: projectCredentialOfRequest(request),
          conversationId: input.conversationId ?? "",
        }),
      ),
    ),
  )

  // ── the control request the card renders ──────────────────────────────────

  .post("/api/langy/local/requests", "langyLocalCreateRequest")
  .withPermission(LOCAL_PERMISSION)
  .withInput(langyLocalCreateRequestBodySchema)
  .withBodyLimit({ maxBytes: MAX_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withResponse("protocol", LOCAL_ANSWER)
  .withDocs({ description: "The recorded request and the command that approves it." })
  .handle(async ({ app, input, request, response }) =>
    response.write(
      localJson(
        await app.createLocalControlRequest({
          credential: projectCredentialOfRequest(request),
          conversationId: input.conversationId,
        }),
      ),
    ),
  )

  // ── one local tool call ───────────────────────────────────────────────────

  .post("/api/langy/local/calls", "langyLocalStartCall")
  .withPermission(LOCAL_PERMISSION)
  // `langyLocalStartCallRequestSchema` intersects a discriminated union, which
  // `.withInput()`'s `SourceSchema` does not admit; parsed by hand instead,
  // exactly as this route always has.
  .withRawBody("text")
  .withBodyLimit({ maxBytes: MAX_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withResponse("protocol", LOCAL_ANSWER)
  .withDocs({ description: "The started call's own id." })
  .handle(async ({ app, raw, request, response }) =>
    response.write(
      localJson(
        await app.startLocalCall({
          credential: projectCredentialOfRequest(request),
          call: parseJsonBody(raw, langyLocalStartCallRequestSchema),
        }),
      ),
    ),
  )

  .get("/api/langy/local/calls/:id", "langyLocalReadCall")
  .withPermission(LOCAL_PERMISSION)
  .withParams(langyLocalCallIdParamsSchema)
  .withResponse("protocol", LOCAL_ANSWER)
  .withDocs({ description: "The call's answer, or not found while it is still running." })
  .handle(async ({ app, input, request, response, signal }) =>
    response.write(
      localJson(
        await app.getLocalCallAnswer({
          credential: projectCredentialOfRequest(request),
          callId: input.id,
          ...(signal ? { signal } : {}),
        }),
      ),
    ),
  )

  .post("/api/langy/local/calls/:id/cancel", "langyLocalCancelCall")
  .withPermission(LOCAL_PERMISSION)
  .withParams(langyLocalCallIdParamsSchema)
  .withResponse("protocol", LOCAL_ANSWER)
  .withDocs({ description: "The cancelled call's own id." })
  .handle(async ({ app, input, request, response }) =>
    response.write(
      localJson(
        await app.cancelLocalCall({
          credential: projectCredentialOfRequest(request),
          callId: input.id,
        }),
      ),
    ),
  )

  // ── the question the worker asks ──────────────────────────────────────────

  .post("/api/langy/waits", "langyLocalStartWait")
  .withPermission(LOCAL_PERMISSION)
  // Same composed-schema reason as `/local/calls` above.
  .withRawBody("text")
  .withBodyLimit({ maxBytes: MAX_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withResponse("protocol", LOCAL_ANSWER)
  .withDocs({ description: "The started wait's own id." })
  .handle(async ({ app, raw, request, response }) =>
    response.write(
      localJson(
        await app.startLocalWait({
          credential: projectCredentialOfRequest(request),
          wait: parseJsonBody(raw, langyLocalStartWaitRequestSchema),
        }),
      ),
    ),
  )

  .get("/api/langy/waits/:id", "langyLocalReadWait")
  .withPermission(LOCAL_PERMISSION)
  .withParams(langyLocalCallIdParamsSchema)
  .withResponse("protocol", LOCAL_ANSWER)
  .withDocs({ description: "The answered question, or not found while it is still waiting." })
  .handle(async ({ app, input, request, response, signal }) =>
    response.write(
      localJson(
        await app.getLocalWaitAnswer({
          credential: projectCredentialOfRequest(request),
          waitId: input.id,
          ...(signal ? { signal } : {}),
        }),
      ),
    ),
  )

  .build();
