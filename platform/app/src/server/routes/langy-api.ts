/**
 * Langy over a project API key — the PUBLIC turn surface.
 *
 * Mounted under `/api/langy`, deliberately NOT under `/api/internal/langy`
 * where `langy-internal` and `langy-relay` live. Those two are worker-plane
 * routes behind `LANGY_INTERNAL_SECRET`, and the Helm chart blocks
 * `/api/internal` at the ingress by default (`charts/langwatch/README.md`
 * `ingress.blockedPaths`). Putting a customer-facing route there would either
 * be unreachable through the ingress or force that block open for everything
 * behind it. So this is a separate plane with a separate credential class.
 *
 * The chain, in refusal order:
 *   1. credential resolves            → else 401
 *   2. `release_langy_api_key_turns_enabled` → else 404 (surface is dark)
 *   3. `langy:create` ceiling         → else 403
 *   4. key owns an actor + has Langy  → else 403
 *   5. actor row still exists         → else 403
 *   6. shared `startConversationTurn` → 202
 *
 * The flag is checked AFTER authentication as a deliberate choice, NOT because
 * it is impossible to check earlier. Rollback is staged per project, so the
 * check that matters is the one evaluated against the caller's own project,
 * and that project is not known until a credential resolves. A project-less
 * evaluation is available -- `isEnabled` requires only `distinctId`, and
 * `resolveEffectiveForListing` in `featureFlag/rules.ts` already evaluates
 * against an empty context in production -- but it answers on the flag's
 * default rather than on the caller's project, so it cannot replace this
 * check. It could be added in front of it as an extra pre-auth filter, which
 * would also close the enumeration gap described below. That is not done here.
 * What the dark surface hides is therefore scoped, and worth stating exactly. A caller holding a real project API key cannot tell
 * whether Langy exists here — that is the rollback property this route is
 * built around. A caller holding no credential, or a bad one, still gets a 401
 * rather than a 404, and so can tell that SOME authenticated route is mounted
 * at this path. That is true of every guarded route on this API and reveals
 * nothing Langy-specific, but it does mean this mechanism is not a defence
 * against anonymous route enumeration, and should not be read as one.
 *
 * The flag is checked BEFORE the ceiling, and that ordering is load-bearing —
 * a key without `langy:create` must not get a 403 out of a surface that is
 * supposed to be dark, because no unmounted route can answer 403. Both this
 * ordering and the byte-parity below are pinned by
 * `__tests__/langy-api-refusal-chain.unit.test.ts`.
 *
 * Every refusal is THROWN, never a hand-built `c.json({...})` —
 * `createServiceApp`'s `onError` owns the wire shape, so this family publishes
 * the same envelope as every other route. The credential, authorization,
 * identity and validation refusals are `HandledError`s, so a caller keeps the
 * `code`, `meta` and remediation `tips` a bespoke `{ message }` would have
 * discarded (ADR-045). The family opts into the `canonical` envelope because it
 * is new: there is no existing consumer parsing the flat legacy shape.
 *
 * The dark-surface 404 is the one deliberate exception, and it does not throw
 * at all: the envelope that makes every other refusal legible is itself the
 * leak here. A thrown 404 comes back as canonical JSON carrying `trace_id` and
 * `span_id` — a shape no unmounted path can produce. So the dark refusal
 * returns `c.notFound()`, Hono's default handler, which is the same handler an
 * unmounted path falls through to.
 *
 * What that pair actually puts on the wire is worth stating precisely, because
 * it is not Hono's default and it is decided in another file. `honoFetchForNode`
 * (`src/start.ts`) intercepts every 404 leaving the app and, when the body is
 * exactly Hono's `404 Not Found` sentinel, rewrites it to
 * `{"error":"Not Found"}` with `Content-Type: application/json`. Production
 * therefore serves JSON here, not plain text. Parity survives because the
 * rewrite keys off that sentinel body and so applies identically to the dark
 * refusal and to an unmounted path — but note the carve-out: a 404 carrying any
 * OTHER body is passed through untouched. That is exactly why this refusal must
 * stay `c.notFound()` and must never hand-build its own 404 JSON; a bespoke body
 * would skip the rewrite and become distinguishable, even at an identical
 * status. The parity assertion in
 * `__tests__/langy-api-refusal-chain.unit.test.ts` compares the two responses at
 * the Hono layer, upstream of that bridge, and covers status, body and
 * Content-Type.
 *
 * Create and continue are the same service call — `conversationId` present or
 * absent is the only difference, exactly as the tRPC router does it. This route
 * owns transport concerns only; every domain rule (ownership, idempotency,
 * capacity, model policy) stays in the app layer and arrives here as a
 * HandledError that is re-thrown untouched.
 */

import type { Context } from "hono";
import { z } from "zod";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import {
  enforceApiKeyCeiling,
  extractCredentials,
} from "~/server/api-key/auth-middleware";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { getApp } from "~/server/app-layer/app";
import {
  LangyApiCredentialInvalidError,
  LangyApiCredentialMissingError,
  LangyApiIdentityDeniedError,
  LangyApiRequestInvalidError,
} from "~/server/app-layer/langy/errors";
import type { LangyChatMessageInput } from "~/server/app-layer/langy/langy-turn.service";
import { resolveLangyActorSession } from "~/server/app-layer/langy/langyApiKeyActorSession";
import { resolveLangyKeyIdentity } from "~/server/app-layer/langy/langyApiKeyIdentity";
import { prisma } from "~/server/db";
import { featureFlagService } from "~/server/featureFlag";
import { bodyLimit } from "./_lib/body-limit";

const tokenResolver = TokenResolver.create(prisma);

const AUTH_REASON =
  "project API key resolved in-handler via TokenResolver + enforceApiKeyCeiling, then bridged to an owning user by resolveLangyKeyIdentity";

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

/** One user turn on the wire. Parts stay opaque; the app layer bounds them. */
const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(z.record(z.string(), z.unknown())).default([]),
});

const turnBodySchema = z.object({
  messages: z.array(messageSchema).min(1),
  idempotencyKey: z.string().min(1),
  modelOverride: z.string().min(1).optional(),
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

  const resolved = await tokenResolver.resolve({
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
  const surfaceOpen = await featureFlagService.isEnabled(
    "release_langy_api_key_turns_enabled",
    {
      distinctId: resolved.project.id,
      projectId: resolved.project.id,
      organizationId: resolved.project.team.organizationId,
    },
  );
  if (!surfaceOpen) return { dark: true as const };

  await enforceApiKeyCeiling({ prisma, resolved, permission: "langy:create" });

  const identity = await resolveLangyKeyIdentity({ resolved });
  if (!identity.ok) {
    throw new LangyApiIdentityDeniedError(
      identity.reason === "unowned"
        ? "langy_api_key_unowned"
        : "langy_api_key_no_langy_access",
      identity.message,
    );
  }

  const actor = await resolveLangyActorSession({
    prisma,
    userId: identity.userId,
    now: new Date(),
  });
  if (!actor.ok) {
    throw new LangyApiIdentityDeniedError(
      "langy_api_actor_missing",
      actor.message,
    );
  }

  return {
    dark: false as const,
    session: actor.session,
    projectId: resolved.project.id,
    markUsed: () => {
      if (resolved.type === "apiKey") {
        tokenResolver.markUsed({ apiKeyId: resolved.apiKeyId });
      }
    },
  };
}

/**
 * Start or continue a turn.
 *
 * Nothing is caught. A domain `HandledError` already carries the status, code
 * and fault the app layer decided on, and anything unhandled is a platform
 * fault the shared handler logs and masks behind a trace id — re-classifying
 * either one here could only lose information.
 */
async function startTurn({
  c,
  conversationId,
}: {
  c: Context;
  conversationId: string | null;
}) {
  const auth = await authorizeTurn(c);
  // Hono's default 404, byte-for-byte what an unmounted path returns.
  if (auth.dark) return c.notFound();

  const parsed = turnBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    throw new LangyApiRequestInvalidError(parsed.error.issues);

  const result = await getApp().langy.turns.startConversationTurn({
    projectId: auth.projectId,
    idempotencyKey: parsed.data.idempotencyKey,
    session: auth.session,
    requestedConversationId: conversationId,
    messages: parsed.data.messages as LangyChatMessageInput[],
    ...(parsed.data.modelOverride
      ? { modelOverride: parsed.data.modelOverride }
      : {}),
    isRetry: false,
    turnContext: {},
  });
  auth.markUsed();
  // 202, not 200: the turn is accepted and dispatched, and the assistant's
  // answer does not exist yet. The caller polls or streams for it.
  return c.json(result, 202);
}

secured
  .access(langyTurnAuth)
  .post(
    "/conversations",
    bodyLimit({ maxSize: MAX_TURN_BODY_BYTES }),
    async (c) => startTurn({ c, conversationId: null }),
  );

secured
  .access(langyTurnAuth)
  .post(
    "/conversations/:conversationId/messages",
    bodyLimit({ maxSize: MAX_TURN_BODY_BYTES }),
    async (c) =>
      startTurn({ c, conversationId: c.req.param("conversationId") }),
  );

export const app = secured.hono;
