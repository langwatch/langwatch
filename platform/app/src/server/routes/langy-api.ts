/**
 * Public project-API-key turn surface. Refusal order is credential (401),
 * per-project rollout (dark 404), ceiling and Langy access (403), then the
 * composed Langy service. The rollout check must follow credential resolution
 * and precede the ceiling: it is evaluated for that key's project and a dark
 * route cannot reveal itself with a 403.
 *
 * The dark branch must stay `c.notFound()`. `honoFetchForNode` normalises its
 * sentinel to the same JSON response as an unmounted route; a handled 404 or
 * bespoke body would expose Langy's canonical error envelope. Characterisation
 * coverage is in `langy-api-refusal-chain.unit.test.ts`.
 *
 * `Prefer: wait=<seconds>` waits for the durable fold and returns the same turn
 * result with terminal fields; expiry preserves the normal 202 response.
 */

import type { Context } from "hono";
import { z } from "zod";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { enforceApiKeyCeiling, extractCredentials } from "~/server/api-key/auth-middleware";
import { appFromContext } from "~/app/api/middleware/app-context";
import {
  LangyApiCredentialInvalidError,
  LangyApiCredentialMissingError,
  LangyApiIdentityDeniedError,
  LangyApiRequestInvalidError,
  langyMessagePartSchema,
} from "@langwatch/langy-contract";
import { resolveLangyActorSession } from "~/runtime/app/features/langy-api-key-actor-session.adapter";
import { resolveLangyKeyIdentity } from "~/runtime/app/features/langy-api-key-identity.adapter";
import { awaitLangyTurnSettlement } from "~/runtime/app/features/langy-turn-settlement.adapter";
import { prisma } from "~/server/db";
import { bodyLimit } from "./_lib/body-limit";

const AUTH_REASON =
  "project API key resolved by context.app.apiKeys and checked with enforceApiKeyCeiling, then bridged to an owning user by resolveLangyKeyIdentity";

/**
 * A turn is text plus small structured parts, never an upload. The cap is well
 * above any real conversation and well below what would let an authenticated
 * key buffer the process into trouble; `createServiceApp` applies no limit of
 * its own, so a route that reads a body has to declare one.
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

const secured = createServiceApp({
  basePath: "/api/langy",
  errorEnvelope: "canonical",
});

/**
 * One user turn on the wire. Parts stay opaque; the app layer bounds them.
 *
 * `content` is the plain-text shorthand a generic HTTP client (a script, a
 * scenario HTTP agent's body template) can produce without restructuring its
 * own message shape; it normalizes to a single text part. When both are sent,
 * `parts` wins — it is the richer form.
 */
const messageSchema = z
  .object({
    role: z.enum(["user", "assistant", "system"]),
    parts: z.array(langyMessagePartSchema).optional(),
    content: z.string().optional(),
  })
  .transform(({ role, parts, content }) => ({
    role,
    parts: parts ?? (content === undefined ? [] : [{ type: "text", text: content }]),
  }));

const turnBodySchema = z.object({
  messages: z.array(messageSchema).min(1),
  idempotencyKey: z.string().min(1),
  modelOverride: z.string().min(1).optional(),
  /**
   * Adopt the path's conversation id as a NEW conversation when it does not
   * exist yet, instead of minting a fresh one. This is how a caller that keys
   * continuity on an externally-chosen id — a scenario run POSTing every turn
   * to `/conversations/{{ threadId }}/messages` — gets one stable conversation
   * across turns: turn 1 adopts the id, turns 2+ find it owned and resume with
   * the durable history. Without it, an unknown id silently yields a fresh
   * conversation per turn, which degrades every multi-turn run to single-turn
   * (#7187). Only meaningful on the `/:conversationId/messages` route.
   */
  adoptConversationId: z.boolean().optional(),
});

/**
 * Authenticate, open the flag, enforce the ceiling, and bridge to an actor.
 *
 * Throws on every refusal EXCEPT the dark surface, which returns `{ dark: true }`
 * for the caller to answer — see the flag check below for why that one cannot
 * throw. `enforceApiKeyCeiling` already throws a `HandledError`
 * (`ApiKeyPermissionDeniedError`), so the ceiling denial needs no translation
 * here at all — catching it only to re-serialise it was how the code, the
 * permission in `meta` and the tips got dropped.
 */
async function authorizeTurn(c: Context) {
  const credentials = extractCredentials((name) => c.req.header(name));
  if (!credentials) throw new LangyApiCredentialMissingError();

  const apiKeys = appFromContext(c).apiKeys;
  const resolved = await apiKeys.tryResolveToken({
    token: credentials.token,
    projectId: credentials.projectId,
  });
  if (!resolved) throw new LangyApiCredentialInvalidError();

  // Dark surface ⇒ 404, not 403: rollback should look like the route was never
  // deployed, so a client retries nothing and no one reads a denial as a
  // permissions bug.
  //
  // This sits BEFORE the ceiling on purpose. Behind it, a key without
  // `langy:create` got a 403 while the flag was off — a refusal no unmounted
  // route can produce, which told the caller the surface was there.
  //
  // It also cannot THROW, unlike every other refusal in this function. Anything
  // thrown here reaches `createServiceApp`'s `onError` and comes back as the
  // canonical JSON envelope, carrying `trace_id` and `span_id`; a path that was
  // never mounted falls to Hono's default handler and comes back as plain-text
  // `404 Not Found`. Content-Type and body would differ, and that difference is
  // the leak this 404 exists to prevent. So the caller answers with
  // `c.notFound()`, which IS that default handler — no router in the chain
  // overrides it.
  const surfaceOpen = await c.app.featureFlags.isEnabled("release_langy_api_key_turns_enabled", {
    kind: "project",
    projectId: resolved.project.id,
    organizationId: resolved.project.team.organizationId,
  });
  if (!surfaceOpen) return { dark: true as const };

  await enforceApiKeyCeiling({ resolved, permission: "langy:create" });

  const identity = await resolveLangyKeyIdentity({
    resolved,
    featureFlags: c.app.featureFlags,
  });
  if (!identity.ok) {
    throw new LangyApiIdentityDeniedError(
      identity.reason === "unowned" ? "langy_api_key_unowned" : "langy_api_key_no_langy_access",
      identity.message,
    );
  }

  const actor = await resolveLangyActorSession({
    users: prisma,
    userId: identity.userId,
    now: new Date(),
  });
  if (!actor.ok) {
    throw new LangyApiIdentityDeniedError("langy_api_actor_missing", actor.message);
  }

  return {
    dark: false as const,
    session: actor.session,
    projectId: resolved.project.id,
    markUsed: () => {
      if (resolved.type === "apiKey") {
        apiKeys.markUsed({ id: resolved.apiKeyId });
      }
    },
  };
}

/**
 * `Prefer: wait=<seconds>` (RFC 7240) opts a caller into synchronous delivery:
 * the request is held until the turn settles and the assistant's reply comes
 * back in the body. The ceiling exists because this connection crosses an
 * ingress with its own idle timeout; a caller asking for more simply gets the
 * ceiling (RFC 7240 §3: a preference is not a contract), and on expiry the
 * response degrades to the exact 202 the async path returns.
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
 * Parse and validate a turn request body. Throws `LangyApiRequestInvalidError`
 * on malformed JSON, schema mismatch, or `adoptConversationId` without an id
 * in the path — adoption without a path id is a caller mistake, and the silent
 * reading (ignore the flag, mint fresh) is exactly the ghost-conversation
 * failure the flag exists to prevent.
 */
async function parseTurnBody(c: Context, conversationId: string | null) {
  const parsed = turnBodySchema.safeParse(await c.req.json().catch(() => null));
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
 * Start or continue a turn.
 *
 * Nothing is caught. A domain `HandledError` already carries the status, code
 * and fault the app layer decided on, and anything unhandled is a platform
 * fault the shared handler logs and masks behind a trace id — re-classifying
 * either one here could only lose information.
 */
async function startTurn({ c, conversationId }: { c: Context; conversationId: string | null }) {
  const auth = await authorizeTurn(c);
  // Hono's default 404, byte-for-byte what an unmounted path returns.
  if (auth.dark) return c.notFound();

  const body = await parseTurnBody(c, conversationId);

  const result = await appFromContext(c).langy.startConversationTurn({
    projectId: auth.projectId,
    idempotencyKey: body.idempotencyKey,
    session: auth.session,
    requestedConversationId: conversationId,
    ...(body.adoptConversationId ? { adoptConversationId: true } : {}),
    messages: body.messages,
    ...(body.modelOverride ? { modelOverride: body.modelOverride } : {}),
    isRetry: false,
    turnContext: {},
  });
  auth.markUsed();

  // `Prefer: wait=<seconds>` holds the connection until the turn settles and
  // returns the assistant's reply in the body — the synchronous mode a plain
  // HTTP client (or a scenario HTTP agent) needs, since this surface has no
  // public poll or stream endpoint yet. On timeout the response degrades to
  // the 202 below, indistinguishable from never having asked.
  const waitSeconds = requestedWaitSeconds(c);
  if (waitSeconds && waitSeconds > 0) {
    // Client disconnect and the wait deadline are one signal: an abandoned
    // hold stops consuming fold reads (and its blocking Redis read) at once.
    const settlement = await awaitLangyTurnSettlement({
      langy: appFromContext(c).langy,
      redis: appFromContext(c).redis ?? null,
      projectId: auth.projectId,
      conversationId: result.conversationId,
      turnId: result.turnId,
      userId: auth.session.user.id,
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
}

secured
  .access(langyTurnAuth)
  .post("/conversations", bodyLimit({ maxSize: MAX_TURN_BODY_BYTES }), async (c) =>
    startTurn({ c, conversationId: null }),
  );

secured
  .access(langyTurnAuth)
  .post(
    "/conversations/:conversationId/messages",
    bodyLimit({ maxSize: MAX_TURN_BODY_BYTES }),
    async (c) => startTurn({ c, conversationId: c.req.param("conversationId") }),
  );

export const app = secured.hono;
