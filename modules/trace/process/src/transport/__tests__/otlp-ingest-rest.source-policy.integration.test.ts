import { createRestRuntime, type RestErrorHandler } from "@langwatch/api/rest";
/**
 * @vitest-environment node
 * The OTLP trace receiver with an ingestion-source credential: what the door
 * answers when the source policy is absent, failed or refused.
 * Spec: specs/server/otlp-receiver-policy.feature
 */
import { PlanLimitExceededError } from "@langwatch/entitlement-contract";
import { HandledError } from "@langwatch/handled-error";
import { LocalFeatureApis } from "@langwatch/process";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { TraceApi, type OtlpIngestCredential } from "@langwatch/trace-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";

import { otlpIngestRest } from "../otlp-ingest.rest.ts";

const PROJECT = { id: "project-123", teamId: "team-1", organizationId: "organization-1" };

const renderRefusal: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();
    return c.json(
      { error: serialized.code, retryable: error.retryable === true, ...error.meta },
      serialized.httpStatus as ContentfulStatusCode,
    );
  }
  return c.json({ error: "Internal server error" }, 500);
};

class SourceDisabledError extends HandledError {
  declare readonly code: "source_disabled";

  constructor() {
    super("source_disabled", "This ingestion source is disabled.", {
      httpStatus: 403,
      fault: "customer",
    });
  }
}

function ingestionSourceDeployment({
  sourcePolicy,
  usageLimit = async () => undefined,
}: {
  sourcePolicy?: NonNullable<OtlpIngestCredential["identity"]["sourcePolicy"]>;
  usageLimit?: () => Promise<void>;
}) {
  const otlpTraces = vi.fn(async () => ({}));
  const credential: OtlpIngestCredential = {
    project: PROJECT,
    identity: {
      apiKeyId: "key_real",
      organizationId: PROJECT.organizationId,
      ingestSourceType: "copilot_vscode",
      ingestionTemplateId: null,
      ...(sourcePolicy ? { sourcePolicy } : {}),
    },
  };
  const apis = new LocalFeatureApis();
  apis.declare(TraceApi);
  apis.bind(
    TraceApi,
    createApiFixture<TraceApi>({
      otlpCredential: async () => credential,
      otlpMarkCredentialUsed: () => undefined,
      otlpUsageLimit: usageLimit,
      otlpReportError: () => undefined,
      otlpTraces,
    }),
  );
  apis.ready();
  const family = createRestRuntime({
    identity: { authenticate: () => ({ authenticated: false }) as never },
  }).mount(otlpIngestRest.router(), {
    app: () => apis.reference(TraceApi),
    credential: "public",
    onError: renderRefusal,
  });
  const post = (body: string) =>
    family.request("/api/otel/v1/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Auth-Token": "sk-lw-ingest" },
      body,
    });
  return { post, otlpTraces };
}

const validBody = JSON.stringify({
  resourceSpans: [
    {
      scopeSpans: [
        {
          scope: { name: "github.copilot" },
          spans: [
            {
              traceId: "b2ca0e1d9f4a4d2ab1c0d3e4f5061728",
              spanId: "a1b2c3d4e5f60718",
              name: "chat",
              startTimeUnixNano: "1720000000000000000",
              endTimeUnixNano: "1720000001000000000",
            },
          ],
        },
      ],
    },
  ],
});

describe("given an ingestion-source credential", () => {
  describe("when no source policy is available", () => {
    /** @scenario "Missing policy never accepts unattributed ingestion-source traffic" */
    it("answers a retryable 503 and queues no command", async () => {
      const { post, otlpTraces } = ingestionSourceDeployment({});

      const response = await post(validBody);

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: "service_unavailable",
        retryable: true,
      });
      expect(otlpTraces).not.toHaveBeenCalled();
    });
  });

  describe("when the policy lookup failed and the body is malformed JSON", () => {
    /** @scenario "Failed policy lookup preserves malformed-body precedence" */
    it("answers 400 and queues no command", async () => {
      const { post, otlpTraces } = ingestionSourceDeployment({
        sourcePolicy: { status: "failed", error: new Error("policy store down") },
      });

      const response = await post("{not json");

      expect(response.status).toBe(400);
      expect(otlpTraces).not.toHaveBeenCalled();
    });
  });

  describe("when the policy resolver returned a handled refusal and the body is valid", () => {
    /** @scenario "A policy error retains its handled response after valid parsing" */
    it("answers the refusal's own status and code and queues no command", async () => {
      const { post, otlpTraces } = ingestionSourceDeployment({
        sourcePolicy: {
          status: "failed",
          error: new SourceDisabledError(),
        },
      });

      const response = await post(validBody);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: "source_disabled" });
      expect(otlpTraces).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization whose month's count has reached its plan's allowance", () => {
  describe("when a trace arrives at OTLP ingest for one of its projects", () => {
    /** @scenario "Ingest past the monthly allowance is refused with the plan limit" */
    it("refuses with ERR_PLAN_LIMIT, status 402 and the reading, and queues no command", async () => {
      const { post, otlpTraces } = ingestionSourceDeployment({
        usageLimit: async () => {
          throw new PlanLimitExceededError("You reached the limit of 1000 traces for this month", {
            currentMonthMessagesCount: 1_000,
            maxMessagesPerMonth: 1_000,
            activePlanName: "Free",
          });
        },
      });

      const response = await post(validBody);

      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toMatchObject({
        error: "ERR_PLAN_LIMIT",
        currentMonthMessagesCount: 1_000,
        maxMessagesPerMonth: 1_000,
        activePlanName: "Free",
      });
      expect(otlpTraces).not.toHaveBeenCalled();
    });
  });
});
