import {
  ClaimRequiresIdentityError,
  OnboardingRateLimitedError,
} from "@langwatch/ai-onboarding";
import {
  createErrorHandler,
  createService,
  routeHandlers,
} from "@langwatch/api";
import {
  claimDirectRequestSchema,
  claimExchangeRequestSchema,
  claimExchangeResponseSchema,
  claimHandoffApproveResponseSchema,
  claimHandoffDescribeResponseSchema,
  claimHandoffStartRequestSchema,
  claimHandoffStartResponseSchema,
  claimResultSchema,
  provisionRequestSchema,
  provisionResponseSchema,
  statusResponseSchema,
} from "@langwatch/contracts/agent-onboarding";
import type { Context } from "hono";
import { z } from "zod";
import { nearestHopIp } from "~/server/http/client-ip";
import { onboardingServices } from "./dependencies";
import { browserSessionAuth, deviceSessionAuth, userIdFrom } from "./identity";

/**
 * `/api/agent-onboarding` — the RPC surface behind `npx langwatch <agent>`.
 *
 * Three groups, three credentials:
 *
 *   - `/provision`, `/status`, `/claim/handoff`, `/claim/exchange` are
 *     unauthenticated. An agent has no identity to present; possession of a
 *     claim token, or of the PKCE verifier, is the capability.
 *   - `/claim/handoff/:code` and `.../approve` take a browser session — they
 *     are the human half of the handoff.
 *   - `/claim/direct` takes a CLI device session, for a terminal that already
 *     logged in.
 *
 * Spec: specs/ai-governance/agent-onboarding/
 */

const CLAIM_TOKEN_HEADER_SCHEMA = z
  .string()
  .min(1, "a claim token is required");

/** The claim token rides as a bearer credential, because that is what it is. */
function claimTokenFrom(c: Context): string {
  const header = c.req.header("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header.trim());
  return CLAIM_TOKEN_HEADER_SCHEMA.parse(bearer?.[1]?.trim() ?? "");
}

function callerIdentity(c: Context) {
  return {
    ip: nearestHopIp(c),
    fingerprint: c.req.header("x-langwatch-fingerprint") ?? null,
  };
}

/**
 * The framework serializes the error body; `Retry-After` is a header, so it
 * is added here rather than duplicating the limiter's arithmetic in a
 * middleware that cannot see the thrown error.
 */
const formatError = createErrorHandler();

async function onError(err: Error, c: Context): Promise<Response> {
  const response = await formatError(err, c);
  if (err instanceof OnboardingRateLimitedError) {
    const retryAfter = err.meta?.retryAfterSeconds;
    if (typeof retryAfter === "number") {
      response.headers.set("Retry-After", String(retryAfter));
    }
  }
  return response;
}

export const app = createService({
  name: "agent-onboarding",
  onError,
})
  .provide({
    onboarding: () => onboardingServices(),
  })
  .version("2026-07-30", (v) => {
    // -----------------------------------------------------------------------
    // Anonymous
    // -----------------------------------------------------------------------

    v.post(
      "/provision",
      {
        auth: "none",
        input: provisionRequestSchema,
        output: provisionResponseSchema,
        status: 201,
        description:
          "Create a temporary, claimable workspace and return an ingestion-only key. No identity required.",
      },
      async (c, { input, app }) =>
        app.onboarding.provisioning.provision({
          request: input,
          identity: callerIdentity(c),
        }),
    );

    v.get(
      "/status",
      {
        auth: "none",
        output: statusResponseSchema,
        description:
          "Lifecycle of the temporary account the presented claim token belongs to.",
      },
      async (c, { app }) =>
        app.onboarding.provisioning.status({ claimToken: claimTokenFrom(c) }),
    );

    // -----------------------------------------------------------------------
    // Claim — PKCE handoff
    // -----------------------------------------------------------------------

    v.post(
      "/claim/handoff",
      {
        auth: "none",
        input: claimHandoffStartRequestSchema,
        output: claimHandoffStartResponseSchema,
        status: 201,
        description:
          "Start a browser handoff for a CLI with no identity. Returns the URL to open and the interval to poll.",
      },
      async (c, { input, app }) =>
        app.onboarding.claim.startHandoff({
          claimToken: input.claimToken,
          codeChallenge: input.codeChallenge,
          identity: callerIdentity(c),
        }),
    );

    v.post(
      "/claim/exchange",
      {
        auth: "none",
        input: claimExchangeRequestSchema,
        output: claimExchangeResponseSchema,
        description:
          "Poll a handoff. Returns pending until the human approves in the browser.",
      },
      async (_c, { input, app }) =>
        app.onboarding.claim.exchange({
          handoffCode: input.handoffCode,
          codeVerifier: input.codeVerifier,
        }),
    );

    // -----------------------------------------------------------------------
    // Claim — the browser half
    // -----------------------------------------------------------------------

    v.get(
      "/claim/handoff/:handoffCode",
      {
        auth: browserSessionAuth,
        params: z.object({ handoffCode: z.string().min(1) }),
        output: claimHandoffDescribeResponseSchema,
        description:
          "What the claim page shows a signed-in human before they approve.",
      },
      async (_c, { params, app }) =>
        app.onboarding.claim.describeHandoff({
          handoffCode: params.handoffCode,
        }),
    );

    v.post(
      "/claim/handoff/:handoffCode/approve",
      {
        auth: browserSessionAuth,
        params: z.object({ handoffCode: z.string().min(1) }),
        output: claimHandoffApproveResponseSchema,
        description:
          "Attach the signed-in identity to the temporary account behind this handoff.",
      },
      async (c, { params, app }) =>
        app.onboarding.claim.approveHandoff({
          handoffCode: params.handoffCode,
          userId: requireUserId(c),
        }),
    );

    // -----------------------------------------------------------------------
    // Claim — a CLI that already has an identity
    // -----------------------------------------------------------------------

    v.post(
      "/claim/direct",
      {
        auth: deviceSessionAuth,
        input: claimDirectRequestSchema,
        output: claimResultSchema,
        description:
          "Claim from a terminal that already holds a device session — no browser round-trip.",
      },
      async (c, { input, app }) =>
        app.onboarding.claim.claimDirect({
          claimToken: input.claimToken,
          userId: requireUserId(c),
          identity: callerIdentity(c),
        }),
    );
  })
  .build();

function requireUserId(c: Context): string {
  const userId = userIdFrom(c);
  if (userId === null) throw new ClaimRequiresIdentityError();
  return userId;
}

export const { GET, POST, PUT, PATCH, DELETE } = routeHandlers(app);
