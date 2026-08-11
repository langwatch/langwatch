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
 * Create and continue are the same service call — `conversationId` present or
 * absent is the only difference, exactly as the tRPC router does it. This route
 * owns transport concerns only; every domain rule (ownership, idempotency,
 * capacity, model policy) stays in the app layer and arrives here as a
 * HandledError.
 */

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import { z } from "zod";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import {
  apiKeyCeilingDenialResponse,
  enforceApiKeyCeiling,
  extractCredentials,
} from "~/server/api-key/auth-middleware";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { getApp } from "~/server/app-layer/app";
import type { LangyChatMessageInput } from "~/server/app-layer/langy/langy-turn.service";
import { resolveLangyActorSession } from "~/server/app-layer/langy/langyApiKeyActorSession";
import { resolveLangyKeyIdentity } from "~/server/app-layer/langy/langyApiKeyIdentity";
import { prisma } from "~/server/db";
import { featureFlagService } from "~/server/featureFlag";

const logger = createLogger("langwatch:langy:api");
const tokenResolver = TokenResolver.create(prisma);

const AUTH_REASON =
  "project API key resolved in-handler via TokenResolver + enforceApiKeyCeiling, then bridged to an owning user by resolveLangyKeyIdentity";

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

const secured = createServiceApp({ basePath: "/api" });

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

/** Authenticate, enforce the ceiling, open the flag, and bridge to an actor. */
async function authorizeTurn(c: Context) {
  const credentials = extractCredentials((name) => c.req.header(name));
  if (!credentials) {
    return {
      failed: true as const,
      status: 401 as const,
      body: {
        message:
          "Authentication token is required. Use X-Auth-Token header, Authorization: Bearer token, or Authorization: Basic base64(projectId:token).",
      },
    };
  }

  const resolved = await tokenResolver.resolve({
    token: credentials.token,
    projectId: credentials.projectId,
  });
  if (!resolved) {
    return {
      failed: true as const,
      status: 401 as const,
      body: { message: "Invalid auth token." },
    };
  }

  try {
    await enforceApiKeyCeiling({
      prisma,
      resolved,
      permission: "langy:create",
    });
  } catch (error) {
    const denial = apiKeyCeilingDenialResponse(error);
    return { failed: true as const, status: denial.status, body: denial.body };
  }

  // Dark surface ⇒ 404, not 403: rollback should look like the route was never
  // deployed, so a client retries nothing and no one reads a denial as a
  // permissions bug.
  const surfaceOpen = await featureFlagService.isEnabled(
    "release_langy_api_key_turns_enabled",
    {
      distinctId: resolved.project.id,
      projectId: resolved.project.id,
      organizationId: resolved.project.team.organizationId,
    },
  );
  if (!surfaceOpen) {
    return {
      failed: true as const,
      status: 404 as const,
      body: { message: "Not found." },
    };
  }

  const identity = await resolveLangyKeyIdentity({ resolved });
  if (!identity.ok) {
    return {
      failed: true as const,
      status: 403 as const,
      body: { message: identity.message },
    };
  }

  const actor = await resolveLangyActorSession({
    prisma,
    userId: identity.userId,
    now: new Date(),
  });
  if (!actor.ok) {
    return {
      failed: true as const,
      status: 403 as const,
      body: { message: actor.message },
    };
  }

  return {
    failed: false as const,
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
 * Start or continue a turn. Domain errors are mapped from their HandledError
 * status rather than re-classified here — the app layer already decided what a
 * capacity refusal or an idempotency mismatch means.
 */
async function startTurn(c: Context, conversationId: string | null) {
  const auth = await authorizeTurn(c);
  if (auth.failed) return c.json(auth.body, auth.status);

  const parsed = turnBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { message: "Invalid request body.", issues: parsed.error.issues },
      400,
    );
  }

  try {
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
  } catch (error) {
    if (error instanceof HandledError) {
      const status = error.httpStatus as 400 | 403 | 404 | 409 | 503;
      return c.json({ message: error.message, code: error.code }, status);
    }
    logger.error({ error }, "langy api turn failed");
    return c.json({ message: "Failed to start turn." }, 500);
  }
}

secured
  .access(langyTurnAuth)
  .post("/langy/conversations", async (c) => startTurn(c, null));

secured
  .access(langyTurnAuth)
  .post("/langy/conversations/:conversationId/messages", async (c) =>
    startTurn(c, c.req.param("conversationId")),
  );

export const app = secured.hono;
