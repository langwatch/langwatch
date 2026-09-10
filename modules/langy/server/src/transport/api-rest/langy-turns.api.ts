/**
 * Public project-API-key turn surface. Refusal order is credential (401), per-project rollout
 * (dark 404), ceiling and Langy access (403), then the composed Langy application.
 */

import { handlerManagedAuth } from "@langwatch/api";
import {
  bodyLimit,
  type AppRestSecurity,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
} from "@langwatch/api/rest";
import {
  LangyApiRequestInvalidError,
  langyRestTurnBodySchema,
} from "@langwatch/langy-contract";
import type { Context } from "hono";
import { z } from "zod";

import type { LangyApp } from "#app/langy.app";
import { LANGY_API_KEY_TURNS_FLAG } from "../../rules/langy-rest-flags.rules.ts";
import {
  resolveLangyRestActor,
  resolveLangyRestCaller,
  type LangyRestCredentialMembers,
} from "./langy-rest-credentials.api.ts";
import {
  type LangyTurnBufferWatch,
  LangyTurnSettlementWaiterService,
} from "#services/langy-turn-settlement-waiter.service";

const AUTH_REASON =
  "project API key resolved by the process's credential port and checked against the API-key ceiling, then bridged to an owning user by resolveLangyKeyIdentity";

/**
 * A turn is text plus small structured parts, never an upload.
 */
const MAX_TURN_BODY_BYTES = 1024 * 1024;

/**
 * `langy:create` is the SAME ceiling the browser's turn-start procedure
 * requires. A key must not be able to start a turn its owner could not start
 * by hand from the UI.
 */
const langyTurnAuth = handlerManagedAuth({
  reason: AUTH_REASON,
  permissions: ["langy:create"],
  credential: "apiKey",
});

/** Everything the turn surface reaches that Langy does not own. */
export type LangyTurnsRestMembers = LangyRestCredentialMembers &
  Readonly<{
    /** The SAME application the browser's Langy procedures resolve on. */
    langy: () => LangyApp;
    /**
     * One turn's live buffer, opened for the length of a `Prefer: wait` hold,
     * or null when this process composed no Redis: the hold is then served by
     * fold reads alone, which is slower and correct rather than absent.
     */
    openTurnBuffer: () => LangyTurnBufferWatch | null;
  }>;

/**
 * `Prefer: wait=<seconds>` (RFC 7240) opts a caller into synchronous delivery: the request is
 * held until the turn settles and the assistant's reply comes back in the body.
 */
const MAX_WAIT_SECONDS = 120;

function requestedWaitSeconds(c: Context): number | null {
  const prefer = c.req.header("prefer");
  if (!prefer) return null;
  // RFC 7240 §2: the value may be a token or a quoted-string (`wait="30"`).
  const match = /(?:^|[,;\s])wait="?(\d{1,4})"?/i.exec(prefer);
  if (!match?.[1]) return null;
  return Math.min(Number(match[1]), MAX_WAIT_SECONDS);
}

/**
 * Parse and validate a turn request body.
 */
async function parseTurnBody(c: Context, conversationId: string | null) {
  const parsed = langyRestTurnBodySchema.safeParse(await c.req.json().catch(() => null));
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

/** Builds the public `/api/langy/conversations` family over one process's ports. */
export function createLangyTurnsRestApp(options: {
  security: AppRestSecurity;
  ports: LangyTurnsRestMembers;
}): MountableRestApp {
  const { security, ports } = options;

  const { service, policy } = security.createServiceVersionedApp({
    name: "langy",
    basePath: "/api/langy",
    // Released CLI builds and scenario HTTP agents post these exact paths;
    // the turn surface serves one generation rather than a dated namespace.
    staticGeneration: "v1",
    errorEnvelope: "canonical",
  });

  const turnDoor = policy(langyTurnAuth);

  /** A turn answers 202, or 200 with the settled reply, or a dark 404. */
  const TURN_ANSWER =
    "the turn surface answers 202 with the accepted turn, 200 with the settled reply " +
    "under Prefer: wait, and Hono's own 404 when the rollout is dark for the project";

  /**
   * Start or continue a turn. Nothing is caught.
   */
  const startTurn = async ({
    c,
    conversationId,
  }: {
    c: Context;
    conversationId: string | null;
  }) => {
    const caller = await resolveLangyRestCaller({
      request: c.req.raw,
      ports,
      flag: LANGY_API_KEY_TURNS_FLAG,
    });
    // Hono's default 404, byte-for-byte what an unmounted path returns.
    if (caller.dark) return c.notFound();

    await ports.enforceCeiling({ resolved: caller.resolved, permission: "langy:create" });
    const session = await resolveLangyRestActor({ ports, userId: caller.userId });

    const body = await parseTurnBody(c, conversationId);

    const langy = ports.langy();
    const result = await langy.langyService.startConversationTurn({
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
    caller.markUsed();

    // `Prefer: wait=<seconds>` holds the connection until the turn settles and
    // returns the assistant's reply in the body — the synchronous mode a plain
    // HTTP client (or a scenario HTTP agent) needs, since this surface has no
    // public poll or stream endpoint yet. On timeout the response degrades to
    // the 202 below, indistinguishable from never having asked.
    const waitSeconds = requestedWaitSeconds(c);
    if (waitSeconds && waitSeconds > 0) {
      // Client disconnect and the wait deadline are one signal: an abandoned
      // hold stops consuming fold reads (and its blocking Redis read) at once.
      const settlement = await LangyTurnSettlementWaiterService.tryAwaitTurnSettlement({
        langy: langy.langyService,
        openBuffer: ports.openTurnBuffer,
        projectId: caller.projectId,
        conversationId: result.conversationId,
        turnId: result.turnId,
        userId: session.user.id,
        signal: AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(waitSeconds * 1000)]),
      });
      if (settlement) {
        // RFC 7240 §3: echo the applied value — it is how a caller asking for
        // more than MAX_WAIT_SECONDS learns what they actually got.
        c.header("Preference-Applied", `wait=${waitSeconds}`);
        // 200 even when the turn itself failed: the REQUEST succeeded — it was
        // authorized, accepted and settled — and `status`/`error` carry the
        // turn's own outcome. Failure here is a domain result, not a transport
        // refusal.
        return c.json(
          {
            ...result,
            status: settlement.outcome,
            error: settlement.error,
            reply: settlement.succeeded
              ? { role: "assistant" as const, text: settlement.text }
              : null,
          },
          200,
        );
      }
    }

    // 202, not 200: the turn is accepted and dispatched, and the assistant's
    // answer does not exist yet. The caller polls or streams for it.
    return c.json(result, 202);
  };

  return service
    .registerRoute(
      "post",
      "/conversations",
      MANAGEMENT_API_VERSION,
      async (c: Context) => startTurn({ c, conversationId: null }),
      (b) =>
        turnDoor(b)
          .withMiddleware(bodyLimit({ maxSize: MAX_TURN_BODY_BYTES }))
          .withRawResponse(TURN_ANSWER),
    )
    .registerRoute(
      "post",
      "/conversations/:conversationId/messages",
      MANAGEMENT_API_VERSION,
      async (c: Context, input: { conversationId: string }) =>
        startTurn({ c, conversationId: input.conversationId }),
      (b) =>
        turnDoor(b)
          .withParams(z.object({ conversationId: z.string().min(1) }))
          .withMiddleware(bodyLimit({ maxSize: MAX_TURN_BODY_BYTES }))
          .withRawResponse(TURN_ANSWER),
    )
    .build();
}
