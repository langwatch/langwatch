/**
 * @vitest-environment node
 *
 * Drives the real internal gateway app the way the Go data plane does: a
 * signed HTTP request carrying the contract 4.6 payload, against real
 * Postgres rows.
 *
 * This is the seam that was broken. The route validated the request against
 * the Prisma storage enum while the data plane sends the wire vocabulary, so
 * every live call was rejected with a 400 and the data plane read that
 * rejection as permission to proceed. A test that only called the service
 * would not have caught it, because the service was never reached.
 *
 * Spec: specs/ai-gateway/guardrail-check-endpoint.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/test-utils/integration/testContainers";
import {
  app,
  buildGatewayCanonicalString,
  computeGatewaySignature,
} from "../gateway-internal";

const PATH = "/api/internal/gateway/guardrail/check";
const suffix = nanoid(8);
const ORG_ID = `org-grc-${suffix}`;
const TEAM_ID = `team-grc-${suffix}`;
const PROJECT_ID = `proj-grc-${suffix}`;
const EVALUATOR_ID = `eval-grc-${suffix}`;
const GUARDRAIL_ID = `gr-grc-${suffix}`;

function signedRequest(body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = process.env.LW_GATEWAY_INTERNAL_SECRET!;
  const signature = computeGatewaySignature(
    secret,
    buildGatewayCanonicalString({
      method: "POST",
      path: PATH,
      timestamp,
      body: raw,
    }),
  );
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LangWatch-Gateway-Signature": signature,
      "X-LangWatch-Gateway-Timestamp": timestamp,
    },
    body: raw,
  });
}

describe("POST /api/internal/gateway/guardrail/check", () => {
  beforeAll(async () => {
    process.env.LW_GATEWAY_INTERNAL_SECRET ??= "test-gateway-secret";
    await startTestContainers();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `GRC Org ${suffix}`, slug: `grc-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `GRC Team ${suffix}`,
        slug: `grc-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `GRC Project ${suffix}`,
        slug: `grc-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "other",
        framework: "other",
        apiKey: `grc-key-${suffix}`,
      },
    });
    await prisma.evaluator.create({
      data: {
        id: EVALUATOR_ID,
        projectId: PROJECT_ID,
        name: `GRC evaluator ${suffix}`,
        type: "evaluator",
        config: {},
      },
    });
    await prisma.monitor.create({
      data: {
        projectId: PROJECT_ID,
        evaluatorId: EVALUATOR_ID,
        checkType: "langevals/basic",
        name: `GRC monitor ${suffix}`,
        slug: `grc-monitor-${suffix}`,
        executionMode: "AS_GUARDRAIL",
        enabled: true,
        preconditions: [],
        parameters: {},
      },
    });
    await prisma.gatewayGuardrail.create({
      data: {
        id: GUARDRAIL_ID,
        projectId: PROJECT_ID,
        name: `GRC guardrail ${suffix}`,
        evaluatorId: EVALUATOR_ID,
        direction: "PRE",
        failureMode: "FAIL_CLOSED",
      },
    });
  }, 180_000);

  afterAll(async () => {
    await stopTestContainers();
  });

  const basePayload = {
    vk_id: "vk_test",
    project_id: PROJECT_ID,
    guardrail_ids: [] as string[],
    content: { messages: [{ role: "user", content: "hello" }] },
  };

  describe("given the directions the data plane actually sends", () => {
    /** @scenario "the endpoint accepts the directions the gateway actually sends" */
    /** @scenario "every contract direction is accepted" */
    it.each([
      "request",
      "response",
      "stream_chunk",
    ])("accepts direction %s", async (direction) => {
      const response = await app.request(
        signedRequest({ ...basePayload, direction }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { decision: string };
      expect(["allow", "block", "modify"]).toContain(body.decision);
    });

    it("rejects the storage enum the schema used to accept", async () => {
      const response = await app.request(
        signedRequest({ ...basePayload, direction: "pre" }),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        error: { code: string };
      };
      expect(body.error.code).toBe("validation_error");
    });

    /** @scenario "a direction outside the contract is rejected" */
    it("rejects a direction outside the contract", async () => {
      const response = await app.request(
        signedRequest({ ...basePayload, direction: "sideways" }),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("validation_error");
    });
  });

  describe("given a fail-closed guardrail whose evaluator cannot run", () => {
    it("returns a block verdict rather than allowing the request", async () => {
      const response = await app.request(
        signedRequest({
          ...basePayload,
          direction: "request",
          guardrail_ids: [GUARDRAIL_ID],
        }),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        decision: string;
        reason: string | null;
        policies_triggered: string[];
      };
      expect(body.decision).toBe("block");
      expect(body.policies_triggered).toContain(GUARDRAIL_ID);
    });
  });

  describe("given the response body of a check a guardrail blocks", () => {
    /** @scenario "the verdict field is named decision, not action" */
    it("names the verdict field decision, which is what the Go client reads", async () => {
      const response = await app.request(
        signedRequest({
          ...basePayload,
          direction: "request",
          guardrail_ids: [GUARDRAIL_ID],
        }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      expect(body.decision).toBe("block");
      expect(body).toHaveProperty("reason");
      expect(body).toHaveProperty("policies_triggered");
      // The Go client used to read "action". If it ever comes back, the two
      // sides have drifted apart again and every verdict silently allows.
      expect(body).not.toHaveProperty("action");
    });
  });

  describe("given an unsigned request", () => {
    it("is rejected", async () => {
      const response = await app.request(
        new Request(`http://localhost${PATH}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...basePayload, direction: "request" }),
        }),
      );
      expect(response.status).toBe(401);
    });
  });

  describe("given project_id is missing", () => {
    it("is rejected rather than evaluating against an unknown scope", async () => {
      const { project_id: _omitted, ...withoutProject } = basePayload;
      const response = await app.request(
        signedRequest({ ...withoutProject, direction: "request" }),
      );
      expect(response.status).toBe(400);
    });
  });
});
