/**
 * The reconciliation routes' doors: who may reach them and on which plan, before
 * any spend is read.
 * @see specs/ai-gateway/gateway-spend-rest.feature
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
  type GatewaySpendDoorApi,
  gatewaySpendBillingPlanGate,
  gatewaySpendRest,
} from "../gateway-spend.rest.ts";

const ORGANIZATION_ID = "organization_1";
const WINDOW = "from=1000&to=2000";

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
    gatewaySpendRest.router(),
    {
      app: () => createApiFixture<GatewaySpendDoorApi>({}),
      onError: canonicalErrorResponse,
      facts: [
        bindRestMiddleware(gatewaySpendBillingPlanGate, () => {
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
    const response = await hono.request(`/api/gateway/v1/spend-events?${WINDOW}`, {
      headers: anonymous ? {} : { Authorization: "Bearer sk-lw-test" },
    });
    return { status: response.status, body: wireBody.parse(await response.json()) };
  };
}

describe("the spend-events route", () => {
  /** @scenario Requests without an org API key are unauthorized */
  it("answers 401 to a request with no credential", async () => {
    const answer = await mount({ planIncludesBilling: true })({ anonymous: true });

    expect(answer.status).toBe(401);
    expect(answer.body).toMatchObject({ type: "unauthenticated", code: "missing_credentials" });
  });

  /** @scenario Without the plan flag the surface refuses politely */
  it("answers 403 naming the enterprise feature when the plan lacks billing events", async () => {
    const answer = await mount({ planIncludesBilling: false })({ anonymous: false });

    expect(answer.status).toBe(403);
    expect(answer.body.message).toContain("enterprise feature");
  });
});
