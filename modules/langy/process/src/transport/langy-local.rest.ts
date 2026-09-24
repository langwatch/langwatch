/**
 * The worker's door onto the developer's folder (ADR-129), deliberately NOT
 * under `/api/internal`. Every refusal is a `HandledError`: the worker's
 * stderr is `/dev/null`, so the HTTP answer is all it has.
 */

import { PayloadTooLargeError } from "@langwatch/api";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  cancelCallResponseSchema,
  controlActionBodySchema,
  createControlRequestResponseSchema,
  LangyApi,
  LangyApiRequestInvalidError,
  langyLocalCallIdParamsSchema,
  langyLocalCreateRequestBodySchema,
  langyLocalStartCallRequestSchema,
  langyLocalStartWaitRequestSchema,
  langyLocalWorkspaceQuerySchema,
  pollCallResponseSchema,
  pollWaitResponseSchema,
  startCallResponseSchema,
  startWaitResponseSchema,
  workspaceStatusSchema,
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
  .withOutput(workspaceStatusSchema)
  .withDocs({
    description: "The code access card's own status document, as the command line reads it.",
  })
  .handle(({ app, input, actor, scope }) =>
    app.getLocalWorkspace({
      actor,
      projectId: scope.id,
      conversationId: input.conversationId ?? "",
    }),
  )

  // ── the control request the card renders ──────────────────────────────────

  .post("/api/langy/local/requests", "langyLocalCreateRequest")
  .withPermission(LOCAL_PERMISSION)
  .withInput(langyLocalCreateRequestBodySchema)
  .withBodyLimit({ maxBytes: MAX_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withOutput(createControlRequestResponseSchema)
  .withDocs({ description: "The recorded request and the command that approves it." })
  .handle(({ app, input, actor, scope }) =>
    app.createLocalControlRequest({
      actor,
      projectId: scope.id,
      conversationId: input.conversationId,
    }),
  )

  // ── one local tool call ───────────────────────────────────────────────────

  .post("/api/langy/local/calls", "langyLocalStartCall")
  .withPermission(LOCAL_PERMISSION)
  // `langyLocalStartCallRequestSchema` intersects a discriminated union, which
  // `.withInput()`'s `SourceSchema` does not admit; parsed by hand instead,
  // exactly as this route always has.
  .withRawBody("text")
  .withBodyLimit({ maxBytes: MAX_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withOutput(startCallResponseSchema)
  .withDocs({ description: "The started call's own id." })
  .handle(({ app, raw, actor, scope }) =>
    app.startLocalCall({
      actor,
      projectId: scope.id,
      call: parseJsonBody(raw, langyLocalStartCallRequestSchema),
    }),
  )

  .get("/api/langy/local/calls/:id", "langyLocalReadCall")
  .withPermission(LOCAL_PERMISSION)
  .withParams(langyLocalCallIdParamsSchema)
  .withOutput(pollCallResponseSchema)
  .withDocs({ description: "The call's answer, or not found while it is still running." })
  .handle(({ app, input, actor, scope, signal }) =>
    app.getLocalCallAnswer({
      actor,
      projectId: scope.id,
      callId: input.id,
      ...(signal ? { signal } : {}),
    }),
  )

  .post("/api/langy/local/calls/:id/cancel", "langyLocalCancelCall")
  .withPermission(LOCAL_PERMISSION)
  .withParams(langyLocalCallIdParamsSchema)
  .withInput(controlActionBodySchema)
  .withOutput(cancelCallResponseSchema)
  .withDocs({ description: "The cancelled call's own id." })
  .handle(({ app, input, actor, scope }) =>
    app.cancelLocalCall({
      actor,
      projectId: scope.id,
      callId: input.id,
    }),
  )

  // ── the question the worker asks ──────────────────────────────────────────

  .post("/api/langy/waits", "langyLocalStartWait")
  .withPermission(LOCAL_PERMISSION)
  // Same composed-schema reason as `/local/calls` above.
  .withRawBody("text")
  .withBodyLimit({ maxBytes: MAX_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withOutput(startWaitResponseSchema)
  .withDocs({ description: "The started wait's own id." })
  .handle(({ app, raw, actor, scope }) =>
    app.startLocalWait({
      actor,
      projectId: scope.id,
      wait: parseJsonBody(raw, langyLocalStartWaitRequestSchema),
    }),
  )

  .get("/api/langy/waits/:id", "langyLocalReadWait")
  .withPermission(LOCAL_PERMISSION)
  .withParams(langyLocalCallIdParamsSchema)
  .withOutput(pollWaitResponseSchema)
  .withDocs({ description: "The answered question, or not found while it is still waiting." })
  .handle(({ app, input, actor, scope, signal }) =>
    app.getLocalWaitAnswer({
      actor,
      projectId: scope.id,
      waitId: input.id,
      ...(signal ? { signal } : {}),
    }),
  )

  .build();
