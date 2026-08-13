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
 *   2. `langy:create` ceiling         → else 403
 *   3. `release_langy_api_key_turns_enabled` → else 404 (surface is dark)
 *   4. key owns an actor + has Langy  → else 403
 *   5. actor row still exists         → else 403
 *   6. shared `startConversationTurn` → 202
 *
 * The flag is checked AFTER authentication on purpose: an unauthenticated
 * caller learns only that the token is bad, never whether the surface exists.
 *
 * Every refusal is a THROWN `HandledError`, never a hand-built `c.json({...})`
 * — `createServiceApp`'s `onError` owns the wire shape, so this family
 * publishes the same envelope as every other route and a caller keeps the
 * `code`, `meta` and remediation `tips` a bespoke `{ message }` would have
 * discarded (ADR-045). The family opts into the `canonical` envelope because
 * it is new: there is no existing consumer parsing the flat legacy shape.
 *
 * Create and continue are the same service call — `conversationId` present or
 * absent is the only difference, exactly as the tRPC router does it. This route
 * owns transport concerns only; every domain rule (ownership, idempotency,
 * capacity, model policy) stays in the app layer and arrives here as a
 * HandledError that is re-thrown untouched.
 */

import type { Context } from "hono";
import { z } from "zod";
import { NotFoundError } from "~/app/api/shared/errors";
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
 * Authenticate, enforce the ceiling, open the flag, and bridge to an actor.
 *
 * Throws on every refusal. `enforceApiKeyCeiling` already throws a
 * `HandledError` (`ApiKeyPermissionDeniedError`), so the ceiling denial needs
 * no translation here at all — catching it only to re-serialise it was how the
 * code, the permission in `meta` and the tips got dropped.
 */
async function authorizeTurn(c: Context) {
  const credentials = extractCredentials((name) => c.req.header(name));
  if (!credentials) throw new LangyApiCredentialMissingError();

  const resolved = await tokenResolver.resolve({
    token: credentials.token,
    projectId: credentials.projectId,
  });
  if (!resolved) throw new LangyApiCredentialInvalidError();

  await enforceApiKeyCeiling({ prisma, resolved, permission: "langy:create" });

  // Dark surface ⇒ 404, not 403: rollback should look like the route was never
  // deployed, so a client retries nothing and no one reads a denial as a
  // permissions bug. The platform's generic `not_found` on purpose — a
  // Langy-specific code here would be the leak the 404 exists to prevent.
  const surfaceOpen = await featureFlagService.isEnabled(
    "release_langy_api_key_turns_enabled",
    {
      distinctId: resolved.project.id,
      projectId: resolved.project.id,
      organizationId: resolved.project.team.organizationId,
    },
  );
  if (!surfaceOpen) throw new NotFoundError("Not Found");

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
async function startTurn(c: Context, conversationId: string | null) {
  const auth = await authorizeTurn(c);

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
    async (c) => startTurn(c, null),
  );

secured
  .access(langyTurnAuth)
  .post(
    "/conversations/:conversationId/messages",
    bodyLimit({ maxSize: MAX_TURN_BODY_BYTES }),
    async (c) => startTurn(c, c.req.param("conversationId")),
  );

export const app = secured.hono;
