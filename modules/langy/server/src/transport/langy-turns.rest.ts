/**
 * `/api/langy/conversations` - the public turn surface a project API key
 * reaches. Released CLI builds and scenario HTTP agents post these exact
 * paths, so the family publishes them literally, with the `/api/v1` twin it
 * has always answered under and no dated namespace.
 *
 * Refusal order is the door's own: credential (401), then the API-key ceiling
 * on `langy:create` (403) - the SAME ceiling the browser's turn-start
 * procedure requires, so a key cannot start a turn its owner could not start
 * by hand - then the per-project rollout (a dark 404), then the identity
 * bridge, then the composed Langy application.
 */
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { PayloadTooLargeError } from "@langwatch/api";
import {
  LangyApi,
  LangyApiIdentityDeniedError,
  LangyApiRequestInvalidError,
  langyRestTurnBodySchema,
} from "@langwatch/langy-contract";
import { z } from "zod";

import { LANGY_API_KEY_TURNS_FLAG } from "../rules/langy-rest-flags.rules.ts";
import {
  type LangyTurnBufferWatch,
  LangyTurnSettlementWaiterService,
} from "../services/langy-turn-settlement-waiter.service.ts";
import type { LangyRestCallerService } from "../services/langy-rest-caller.service.ts";
import type { LangyIdentityToken } from "../services/langy-key-identity.service.ts";

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
 * What the PROCESS supplies the turn surface beyond Langy's own application:
 * the rollout store and the user directory a key is bridged through, and this
 * process's live turn buffer. A fact rather than a member of the App because
 * none of it is Langy's to own.
 */
export const langyTurnsMembers = defineRestMiddleware(
  "langyTurnsMembers",
  z.custom<LangyTurnsRestMembers>(),
);

const turnParamsSchema = z.object({ conversationId: z.string().min(1) });

/** Hono's own 404, byte-for-byte what an unmounted path returns. */
const darkAnswer = (): Response => new Response("404 Not Found", { status: 404 });

function requestedWaitSeconds(request: Request): number | null {
  const prefer = request.headers.get("prefer");
  if (!prefer) return null;
  // RFC 7240 §2: the value may be a token or a quoted-string (`wait="30"`).
  const match = /(?:^|[,;\s])wait="?(\d{1,4})"?/i.exec(prefer);
  if (!match?.[1]) return null;

  return Math.min(Number(match[1]), MAX_WAIT_SECONDS);
}

/** Parse and validate a turn request body. */
function parseTurnBody(raw: string, conversationId: string | null) {
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
  raw: string;
  conversationId: string | null;
}): Promise<Response> {
  const { app, members, request, conversationId } = input;
  // The door already resolved this key and enforced `langy:create` as its
  // ceiling; reading its answer back here asks the key store nothing twice.
  const resolved: LangyIdentityToken = projectCredentialOfRequest(request);
  const caller = await members.callers.resolve({
    resolved,
    flag: LANGY_API_KEY_TURNS_FLAG,
  });
  if (caller.dark) return darkAnswer();

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
      return Response.json(
        {
          ...result,
          status: settlement.outcome,
          error: settlement.error,
          reply: settlement.succeeded ? { role: "assistant" as const, text: settlement.text } : null,
        },
        {
          status: 200,
          // RFC 7240 §3: echo the applied value - it is how a caller asking
          // for more than MAX_WAIT_SECONDS learns what they actually got.
          headers: { "Preference-Applied": `wait=${waitSeconds}` },
        },
      );
    }
  }

  // 202, not 200: the turn is accepted and dispatched, and the assistant's
  // answer does not exist yet. The caller polls or streams for it.
  return Response.json(result, { status: 202 });
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
  .withRawResponse({ produces: "application/json" })
  .withBodyLimit({ maxBytes: MAX_TURN_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withDocs({ description: `Start a Langy conversation with one turn. ${TURN_ANSWER}` })
  .withMiddleware(langyTurnsMembers)
  .handle(async ({ app, raw, request }, members) =>
    startTurn({ app, members, request, raw, conversationId: null }),
  )

  .post("/api/langy/conversations/:conversationId/messages", "continueLangyConversationTurn")
  .withPermission("langy:create")
  .withParams(turnParamsSchema)
  .withRawBody("text")
  .withRawResponse({ produces: "application/json" })
  .withBodyLimit({ maxBytes: MAX_TURN_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withDocs({ description: `Continue one Langy conversation with a turn. ${TURN_ANSWER}` })
  .withMiddleware(langyTurnsMembers)
  .handle(async ({ app, input, raw, request }, members) =>
    startTurn({
      app,
      members,
      request,
      raw,
      conversationId: input.conversationId,
    }),
  )

  .build();
