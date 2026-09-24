import { PayloadTooLargeError } from "@langwatch/api";
/** /api/langy/conversations: public turn surface for CLI/HTTP agents. Published literally
 * with /api/v1 twin. Refusal order: credential (401), API-key langy:create ceiling (403),
 * per-project rollout flag, identity bridge, then application. */
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestAnswer,
  type RestProtocolProducer,
} from "@langwatch/api/rest";
import {
  LangyApi,
  LangyApiRequestInvalidError,
  langyRestConversationParamsSchema,
  langyRestTurnBodySchema,
  type LangyKeyCaller,
} from "@langwatch/langy-contract";
import type { z } from "zod";

/**
 * A turn is text plus small structured parts, never an upload.
 */
const MAX_TURN_BODY_BYTES = 1024 * 1024;

/**
 * `Prefer: wait=<seconds>` (RFC 7240) opts a caller into synchronous delivery:
 * the request is held until the turn settles and the assistant's reply comes
 * back in the body.
 */
const MAX_WAIT_SECONDS = 120;

/** Hono's own 404, byte-for-byte what an unmounted path returns. */
const HONO_NOT_FOUND = {
  status: 404,
  mediaType: "text/plain;charset=UTF-8",
  body: "404 Not Found",
} as const;

/** What a turn route publishes: its JSON answers, and the dark surface's bare 404. */
const TURN_PRODUCES = ["application/json", "text/plain;charset=UTF-8"] as const;

function parseRequestedWaitSeconds(request: Request): number | null {
  const prefer = request.headers.get("prefer");
  if (!prefer) return null;
  // RFC 7240 §2: the value may be a token or a quoted-string (`wait="30"`).
  const match = /(?:^|[,;\s])wait="?(\d{1,4})"?/i.exec(prefer);
  if (!match?.[1]) return null;

  return Math.min(Number(match[1]), MAX_WAIT_SECONDS);
}

/** Parse and validate a turn request body. */
function parseTurnBody(
  raw: string,
  conversationId: string | null,
): z.infer<typeof langyRestTurnBodySchema> {
  let body: unknown;

  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }

  const parsed = langyRestTurnBodySchema.safeParse(body);
  if (!parsed.success) throw new LangyApiRequestInvalidError(parsed.error.issues);

  if (parsed.data.adoptConversationId && !conversationId) {
    throw new LangyApiRequestInvalidError([
      {
        path: ["adoptConversationId"],
        message:
          "adoptConversationId requires the conversation id in the path: POST /conversations/:conversationId/messages",
      },
    ]);
  }

  return parsed.data;
}

/**
 * Start or continue a turn. Nothing is caught: every refusal is a
 * `HandledError` the REST boundary renders, and the dark surface is the one
 * answer that is not.
 */
async function startTurn(input: {
  app: LangyApi;
  key: LangyKeyCaller;
  request: Request;
  response: RestProtocolProducer<typeof TURN_PRODUCES>;
  raw: string;
  conversationId: string | null;
}): Promise<RestAnswer<"protocol">> {
  const { app, request, response, conversationId } = input;
  // The door already resolved this key and enforced `langy:create` as its
  // ceiling; reading its answer back here asks the key store nothing twice.
  const caller = await app.getRestCaller({ ...input.key, surface: "turns" });
  if (caller.dark) return response.write(HONO_NOT_FOUND);

  const session = await app.getRestActor({ userId: caller.userId });

  const body = parseTurnBody(input.raw, conversationId);

  const result = await app.startConversationTurn({
    projectId: caller.projectId,
    idempotencyKey: body.idempotencyKey,
    session,
    requestedConversationId: conversationId,
    ...(body.adoptConversationId ? { adoptConversationId: true } : {}),
    messages: body.messages,
    ...(body.modelOverride ? { modelOverride: body.modelOverride } : {}),
    isRetry: false,
    turnContext: {},
  });

  // `Prefer: wait=<seconds>` holds the connection until the turn settles and
  // returns the assistant's reply in the body - the synchronous mode a plain
  // HTTP client (or a scenario HTTP agent) needs, since this surface has no
  // public poll or stream endpoint yet. On timeout the response degrades to
  // the 202 below, indistinguishable from never having asked.
  const waitSeconds = parseRequestedWaitSeconds(request);

  if (waitSeconds && waitSeconds > 0) {
    // Client disconnect and the wait deadline are one signal: an abandoned
    // hold stops consuming fold reads (and its blocking Redis read) at once.
    const wait = await app.awaitTurnSettlement({
      projectId: caller.projectId,
      conversationId: result.conversationId,
      turnId: result.turnId,
      userId: session.user.id,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(waitSeconds * 1000)]),
    });

    if (wait.kind === "settled") {
      const { settlement } = wait;
      // 200 even when the turn itself failed: the REQUEST succeeded - it was
      // authorized, accepted and settled - and `status`/`error` carry the
      // turn's own outcome. Failure here is a domain result, not a transport
      // refusal.
      return response.write({
        status: 200,
        mediaType: "application/json",
        body: JSON.stringify({
          ...result,
          status: settlement.outcome,
          error: settlement.error,
          reply: settlement.succeeded
            ? { role: "assistant" as const, text: settlement.text }
            : null,
        }),
        // RFC 7240 §3: echo the applied value - it is how a caller asking
        // for more than MAX_WAIT_SECONDS learns what they actually got.
        headers: { "Preference-Applied": `wait=${waitSeconds}` },
      });
    }
  }

  // 202, not 200: the turn is accepted and dispatched, and the assistant's
  // answer does not exist yet. The caller polls or streams for it.
  return response.write({
    status: 202,
    mediaType: "application/json",
    body: JSON.stringify(result),
  });
}

/** A turn answers 202, or 200 with the settled reply, or a dark 404. */
const TURN_ANSWER =
  "The turn surface answers 202 with the accepted turn, 200 with the settled reply under " +
  "Prefer: wait, and a plain 404 when the rollout is dark for the project.";

export const langyTurnsRest = defineRestRouter(LangyApi)
  .withNamespace("langy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("project")
  .withAddressing("literal", { v1Twin: true })

  .post("/api/langy/conversations", "startLangyConversationTurn")
  .withPermission("langy:create")
  .withRawBody("text")
  .withResponse("protocol", { produces: TURN_PRODUCES, because: TURN_ANSWER })
  .withBodyLimit({ maxBytes: MAX_TURN_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withDocs({ description: `Start a Langy conversation with one turn. ${TURN_ANSWER}` })
  .handle(async ({ app, raw, request, response, actor, scope }) =>
    startTurn({
      app,
      key: { actor, projectId: scope.id },
      request,
      response,
      raw,
      conversationId: null,
    }),
  )

  .post("/api/langy/conversations/:conversationId/messages", "continueLangyConversationTurn")
  .withPermission("langy:create")
  .withParams(langyRestConversationParamsSchema)
  .withRawBody("text")
  .withResponse("protocol", { produces: TURN_PRODUCES, because: TURN_ANSWER })
  .withBodyLimit({ maxBytes: MAX_TURN_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withDocs({ description: `Continue one Langy conversation with a turn. ${TURN_ANSWER}` })
  .handle(async ({ app, input, raw, request, response, actor, scope }) =>
    startTurn({
      app,
      key: { actor, projectId: scope.id },
      request,
      response,
      raw,
      conversationId: input.conversationId,
    }),
  )

  .build();
