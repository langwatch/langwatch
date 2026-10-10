import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
/**
 * @vitest-environment node
 * Both ingestion doors over a real trace application asking entitlement's allowance.
 * Spec: specs/server/api-process-plan-allowance.feature
 */
import { type EntitlementApi, PlanLimitExceededError } from "@langwatch/entitlement-contract";
import { LocalFeatureApis } from "@langwatch/process";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { TraceApi, type OtlpIngestCredential } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { createTraceAppHarness } from "../../app/__tests__/support/trace-app.harness.ts";
import { TraceIngestAllowanceService } from "../../features/ingestion/services/trace-ingest-allowance.service.ts";
import type { TraceIngestCredentialService } from "../../features/ingestion/services/trace-ingest-credential.service.ts";
import type { TraceIngestionService } from "../../features/ingestion/services/trace-ingestion.service.ts";
import { CollectorApi, collectorRest } from "../collector.rest.ts";
import { otlpIngestDoor, otlpIngestRest } from "../otlp-ingest.rest.ts";

const PROJECT = { id: "project-1", teamId: "team-1", organizationId: "organization-1" };

const OTLP_CREDENTIAL: OtlpIngestCredential = {
  project: PROJECT,
  identity: {
    apiKeyId: "key-1",
    organizationId: PROJECT.organizationId,
    ingestSourceType: null,
    ingestionTemplateId: null,
  },
};

const NOW = Date.now();

const collectorBody = JSON.stringify({
  trace_id: "trace-1",
  spans: [
    {
      type: "span",
      span_id: "span-1",
      trace_id: "trace-1",
      timestamps: { started_at: NOW, finished_at: NOW + 1_000 },
    },
  ],
});

const otlpBody = JSON.stringify({
  resourceSpans: [
    {
      scopeSpans: [
        {
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

const overAllowance = () =>
  new PlanLimitExceededError("You reached the limit of 1000 events for this month", {
    currentMonthMessagesCount: 1_000,
    maxMessagesPerMonth: 1_000,
    activePlanName: "Free",
  });

/** The trace application both doors mount over, asking the allowance it is handed. */
function bootIngestDoors(assertWithinUsageLimit: EntitlementApi["assertWithinUsageLimit"]) {
  const { logger, lines } = createTestLogger();
  const asked = vi.fn(assertWithinUsageLimit);
  const ingestNormalizedSpan = vi.fn(async () => ({ status: "collected" as const }));
  const handleOtlpTraceRequest = vi.fn(async () => ({
    rejectedSpans: 0,
    ingestionFailures: 0,
    ingestionFailureMessage: "",
    errorMessage: "",
  }));
  const app = createTraceAppHarness({
    ingestCredential: createApiFixture<TraceIngestCredentialService>({
      resolveForCollector: async () => ({ project: PROJECT, markUsed: () => undefined }),
      resolveForOtlp: async () => OTLP_CREDENTIAL,
      markOtlpCredentialUsed: () => undefined,
    }),
    ingestion: createApiFixture<TraceIngestionService>({
      ingestNormalizedSpan,
      handleOtlpTraceRequest,
    }),
    ingestAllowance: TraceIngestAllowanceService.create({
      entitlement: { assertWithinUsageLimit: asked },
      logger,
    }),
  });
  const runtime = createRestRuntime({
    doors: {
      otlp_ingest: otlpIngestDoor((input) => apis.reference(TraceApi).otlpCredential(input)),
    },
    authorization: restTestAuthorization(),
    identity: { authenticate: () => ({ authenticated: false }) as never },
  });
  // The process hands every door the bound reference, never the bare module.
  const apis = new LocalFeatureApis();
  apis.declare(TraceApi);
  apis.declare(CollectorApi);
  apis.bind(TraceApi, app);
  apis.bind(CollectorApi, app);
  apis.ready();
  const mounted = { credential: "public" as const, onError: canonicalErrorResponse };
  const collector = runtime.mount(collectorRest.router(), {
    ...mounted,
    app: () => apis.reference(CollectorApi),
  });
  const otlp = runtime.mount(otlpIngestRest.router(), {
    ...mounted,
    credential: "otlp_ingest",
    app: () => apis.reference(TraceApi),
  });
  const headers = { "Content-Type": "application/json", "X-Auth-Token": "sk-lw-ingest" };
  return {
    lines,
    asked,
    enqueued: () => [
      ingestNormalizedSpan.mock.calls.length,
      handleOtlpTraceRequest.mock.calls.length,
    ],
    postCollector: () =>
      collector.request("/api/collector", { method: "POST", headers, body: collectorBody }),
    postOtlp: () =>
      otlp.request("/api/otel/v1/traces", { method: "POST", headers, body: otlpBody }),
  };
}

describe("given an organization over its monthly allowance", () => {
  describe("when it exports to either ingest door", () => {
    /** @scenario "An export over the plan's allowance is refused terminally" */
    /** @scenario "The collector door refuses exactly as the OTLP door does" */
    it("answers both with a non-retryable 402 ERR_PLAN_LIMIT and enqueues nothing", async () => {
      const doors = bootIngestDoors(async () => {
        throw overAllowance();
      });

      for (const response of [await doors.postCollector(), await doors.postOtlp()]) {
        expect(response.status).toBe(402);
        await expect(response.json()).resolves.toMatchObject({
          error: "ERR_PLAN_LIMIT",
          message: "You reached the limit of 1000 events for this month",
          currentMonthMessagesCount: 1_000,
          maxMessagesPerMonth: 1_000,
          activePlanName: "Free",
          retryable: false,
        });
      }
      expect(doors.enqueued()).toEqual([0, 0]);
    });
  });
});

describe("given an organization inside its monthly allowance", () => {
  describe("when it exports to either ingest door", () => {
    /** @scenario "An export within the plan's allowance is ingested" */
    it("ingests both exports", async () => {
      const doors = bootIngestDoors(async () => undefined);

      expect((await doors.postCollector()).status).toBe(200);
      expect((await doors.postOtlp()).status).toBe(200);
      expect(doors.enqueued()).toEqual([1, 1]);
    });

    /** @scenario "Both doors ask the allowance of the organization the credential resolved" */
    it("asks the allowance of the credential's organization at each door", async () => {
      const doors = bootIngestDoors(async () => undefined);

      await doors.postCollector();
      await doors.postOtlp();

      expect(doors.asked.mock.calls).toEqual([
        [{ organizationId: PROJECT.organizationId }],
        [{ organizationId: PROJECT.organizationId }],
      ]);
    });
  });
});

describe("given an allowance lookup that fails", () => {
  describe("when telemetry is exported", () => {
    /** @scenario "An allowance the process could not read accepts the export" */
    it("ingests the export and logs the failed reading", async () => {
      const doors = bootIngestDoors(async () => {
        throw new Error("rollup unreachable");
      });

      expect((await doors.postCollector()).status).toBe(200);
      expect((await doors.postOtlp()).status).toBe(200);
      expect(doors.enqueued()).toEqual([1, 1]);
      expect(doors.lines.findLine("error", "Error checking trace limit")).toMatchObject({
        projectId: PROJECT.id,
      });
    });
  });
});
