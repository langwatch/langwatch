/**
 * The spend replay route's doors, at main's path: who may reach it and on which plan, before
 * any envelope is read.
 * @see modules/webhook/specs/webhook-gateway-events.feature
 */
// @vitest-environment node
import { ProjectMissingCredentialsError } from "@langwatch/api";
import {
  bindRestMiddleware,
  canonicalErrorResponse,
  createRestRuntime,
  ForbiddenError,
} from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type WebhookSpendReplayDoorApi,
  webhookSpendReplayPlanGate,
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
  const hono = createRestRuntime({ identity: { authenticate: door, identify: door } }).mount(
    webhookSpendReplayRest.router(),
    {
      app: () => createApiFixture<WebhookSpendReplayDoorApi>({}),
      onError: canonicalErrorResponse,
      facts: [
        bindRestMiddleware(webhookSpendReplayPlanGate, () => {
          if (!planIncludesBilling) {
            throw new ForbiddenError(
              "The billing events API is an enterprise feature; this organization's plan does not include it.",
            );
          }
          return {};
        }),
      ],
    },
  );

  return async ({ anonymous }: { anonymous: boolean }) => {
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
}

describe("the spend replay route", () => {
  /** @scenario "The spend replay answers at main's path behind main's permission and plan gate" */
  it("answers 403 naming the enterprise feature when the plan lacks billing events", async () => {
    const answer = await mount({ planIncludesBilling: false })({ anonymous: false });

    expect(answer.status).toBe(403);
    expect(answer.body.message).toContain("enterprise feature");
  });

  it("answers 401 to a request with no credential", async () => {
    const answer = await mount({ planIncludesBilling: true })({ anonymous: true });

    expect(answer.status).toBe(401);
  });
});
