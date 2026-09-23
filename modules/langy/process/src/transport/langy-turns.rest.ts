import { PayloadTooLargeError } from "@langwatch/api";
/** /api/langy/conversations: public turn surface for CLI/HTTP agents. Published literally
 * with /api/v1 twin. Refusal order: credential (401), API-key langy:create ceiling (403),
 * per-project rollout flag, identity bridge, then application. */
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectCredentialOfRequest,
  type RestAnswer,
  type RestProtocolProducer,
} from "@langwatch/api/rest";
import {
  LangyApi,
  LangyApiIdentityDeniedError,
  LangyApiRequestInvalidError,
  langyRestConversationParamsSchema,
  langyRestTurnBodySchema,
} from "@langwatch/langy-contract";
import { z } from "zod";

import { LANGY_API_KEY_TURNS_FLAG } from "../rules/langy-rest-flags.rules.ts";
import type { LangyIdentityToken } from "../services/langy-key-identity.service.ts";
import type { LangyRestCallerService } from "../services/langy-rest-caller.service.ts";
import {
  type LangyTurnBufferWatch,
  LangyTurnSettlementWaiterService,
} from "../services/langy-turn-settlement-waiter.service.ts";

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

/** Everything the turn surface reaches that Langy does not own. */
export type LangyTurnsRestMembers = Readonly<{
  /** The credential chain both public Langy REST families share. */
  callers: LangyRestCallerService;
  /**
   * One turn's live buffer, opened for the length of a `Prefer: wait` hold, or
   * null when this process composed no Redis: the hold is then served by fold
   * reads alone, which is slower and correct rather than absent.
   */
  openTurnBuffer: () => LangyTurnBufferWatch | null;
}>;

/**
 * What the PROCESS supplies the turn surface beyond Langy's own
 * application: the rollout store, the user directory a key bridges
 * through, and this process's live turn buffer - none of it Langy's to own.
 */
export const langyTurnsMembers = defineRestMiddleware(
  "langyTurnsMembers",
  z.custom<LangyTurnsRestMembers>(),
);

/** Hono's own 404, byte-for-byte what an unmounted path returns. */
const HONO_NOT_FOUND = {
  status: 404,
  mediaType: "text/plain;charset=UTF-8",
  body: "404 Not Found",
} as const;

/** What a turn route publishes: its JSON answers, and the dark surface's bare 404. */
const TURN_PRODUCES = ["application/json", "text/plain;charset=UTF-8"] as const;

function requestedWaitSeconds(request: Request): number | null {
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
  members: LangyTurnsRestMembers;
  request: Request;
  response: RestProtocolProducer<typeof TURN_PRODUCES>;
  raw: string;
  conversationId: string | null;
}): Promise<RestAnswer<"protocol">> {
  const { app, members, request, response, conversationId } = input;
  // The door already resolved this key and enforced `langy:create` as its
  // ceiling; reading its answer back here asks the key store nothing twice.
  const resolved: LangyIdentityToken = projectCredentialOfRequest(request);
  const caller = await members.callers.resolve({
    resolved,
    flag: LANGY_API_KEY_TURNS_FLAG,
  });
  if (caller.dark) return response.write(HONO_NOT_FOUND);

  const actor = await members.callers.resolveActor({ userId: caller.userId });
  if (!actor.ok) throw new LangyApiIdentityDeniedError("langy_api_actor_missing", actor.message);

  const body = parseTurnBody(input.raw, conversationId);

  const result = await app.startConversationTurn({
    projectId: caller.projectId,
    idempotencyKey: body.idempotencyKey,
    session: actor.session,
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
  const waitSeconds = requestedWaitSeconds(request);

  if (waitSeconds && waitSeconds > 0) {
    // Client disconnect and the wait deadline are one signal: an abandoned
    // hold stops consuming fold reads (and its blocking Redis read) at once.
    const settlement = await LangyTurnSettlementWaiterService.tryAwaitTurnSettlement({
      langy: app,
      openBuffer: members.openTurnBuffer,
      projectId: caller.projectId,
      conversationId: result.conversationId,
      turnId: result.turnId,
      userId: actor.session.user.id,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(waitSeconds * 1000)]),
    });

    if (settlement) {
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
  .withMiddleware(langyTurnsMembers)
  .handle(async ({ app, raw, request, response }, members) =>
    startTurn({ app, members, request, response, raw, conversationId: null }),
  )

  .post("/api/langy/conversations/:conversationId/messages", "continueLangyConversationTurn")
  .withPermission("langy:create")
  .withParams(langyRestConversationParamsSchema)
  .withRawBody("text")
  .withResponse("protocol", { produces: TURN_PRODUCES, because: TURN_ANSWER })
  .withBodyLimit({ maxBytes: MAX_TURN_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withDocs({ description: `Continue one Langy conversation with a turn. ${TURN_ANSWER}` })
  .withMiddleware(langyTurnsMembers)
  .handle(async ({ app, input, raw, request, response }, members) =>
    startTurn({
      app,
      members,
      request,
      response,
      raw,
      conversationId: input.conversationId,
    }),
  )

  .build();
