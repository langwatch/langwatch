/**
 * The spend replay route's doors, at main's path: who may reach it and on which plan, before
 * any envelope is read.
 * @see modules/webhook/specs/webhook-gateway-events.feature
 */
// @vitest-environment node
import { ProjectMissingCredentialsError } from "@langwatch/api";
import type { Entitlements } from "@langwatch/api/access";
import { canonicalErrorResponse, createRestRuntime, ForbiddenError } from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  type WebhookSpendReplayDoorApi,
  webhookSpendReplayRest,
} from "../webhook-spend-replay.rest.ts";

const ORGANIZATION_ID = "organization_1";
const BODY = { from: 1_000, to: 2_000, endpoint_id: "we_1" };

const wireBody = z.object({
  type: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});

function mount({ planIncludesBilling }: { planIncludesBilling: boolean }) {
  const door = ({ request }: { request: Request }) => {
    if (!request.headers.get("Authorization")) throw new ProjectMissingCredentialsError();
    return {
      actor: { type: "api_key" as const, id: "key_1" },
      scope: { tier: "organization" as const, id: ORGANIZATION_ID },
    };
  };
  // The plan port as auth's door answers it: webhook_endpoints refuses with main's 403.
  const holds = vi.fn<Entitlements["holds"]>(async () => planIncludesBilling);
  const entitlements: Entitlements = {
    holds,
    refusal: () =>
      new ForbiddenError(
        "The billing events API is an enterprise feature; this organization's plan does not include it.",
      ),
  };
  const hono = createRestRuntime({
    identity: { authenticate: door, identify: door },
    entitlements,
  }).mount(webhookSpendReplayRest.router(), {
    app: () => createApiFixture<WebhookSpendReplayDoorApi>({}),
    onError: canonicalErrorResponse,
  });

  const ask = async ({ anonymous }: { anonymous: boolean }) => {
    const response = await hono.request("/api/gateway/v1/spend-events/replay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(anonymous ? {} : { Authorization: "Bearer sk-lw-test" }),
      },
      body: JSON.stringify(BODY),
    });
    return { status: response.status, body: wireBody.parse(await response.json()) };
  };

  return Object.assign(ask, { holds });
}

describe("the spend replay route", () => {
  /** @scenario "The spend replay answers at main's path behind main's permission and plan gate" */
  it("answers 403 naming the enterprise feature when the plan lacks billing events", async () => {
    const ask = mount({ planIncludesBilling: false });
    const answer = await ask({ anonymous: false });

    expect(answer.status).toBe(403);
    expect(answer.body.message).toContain("enterprise feature");
    expect(ask.holds).toHaveBeenCalledWith({
      entitlement: "webhook_endpoints",
      scope: { tier: "organization", id: ORGANIZATION_ID },
    });
  });

  it("answers 401 to a request with no credential", async () => {
    const ask = mount({ planIncludesBilling: true });
    const answer = await ask({ anonymous: true });

    expect(answer.status).toBe(401);
    expect(ask.holds).not.toHaveBeenCalled();
  });
});
