// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * `/api/ingest`: the gate every push-mode receiver shares, the origin metadata
 * it stamps authoritatively, and what an exporter is told about a signal this
 * deployment folds nowhere. Spec: specs/ai-gateway/governance/
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { createRestRuntime, type RestErrorHandler } from "@langwatch/api/rest";
import type {
  GovernanceIngestionSource,
  GovernanceRestApi,
} from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { RateLimiter } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import { memoryRateLimiter } from "@langwatch/test-harness";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryOttlTransformChannel } from "../../channels/memory/memory.ottl-transform.channel.ts";
import { CanonicalCostExtractorService } from "../../services/canonical-cost-extractor.service.ts";
import { GovernanceIngestAccessService } from "../../services/governance-ingest-access.service.ts";
import { GovernanceIngestPrincipalService } from "../../services/governance-ingest-principal.service.ts";
import {
  GovernanceIngestReceiverService,
  type GovernanceIngestLogCollectionChannel,
  type GovernanceIngestMetricCollectionChannel,
  type GovernanceIngestTraceCollection,
} from "../../services/governance-ingest-receiver.service.ts";
import { GovernanceIngestService } from "../../services/governance-ingest.service.ts";
import type { IngestionSourceService } from "../../services/ingestion-source.service.ts";
import { governanceIngestRest } from "../governance-ingest.rest.ts";

const SECRET = "lw_is_abcdef123";
const SOURCE_ID = "src_1";
const ORGANIZATION_ID = "org_1";

const SOURCE: GovernanceIngestionSource = {
  id: SOURCE_ID,
  organizationId: ORGANIZATION_ID,
  teamId: null,
  sourceType: "otel_generic",
  name: "Workato",
  status: "active",
  description: null,
  parserConfig: {},
  lastEventAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  archivedAt: null,
  ingestSecretHash: "hash-of-the-secret",
  pollerCursor: null,
  errorCount: 0,
  pullSchedule: null,
  createdById: null,
};

const renderHandled: RestErrorHandler = (error) =>
  HandledError.isHandled(error)
    ? new Response(JSON.stringify({ code: error.code, message: error.message }), {
        status: error.httpStatus,
        headers: { "content-type": "application/json" },
      })
    : new Response(JSON.stringify({ code: "server_error" }), { status: 500 });

type World = {
  source?: GovernanceIngestionSource | null;
  rateLimiter?: RateLimiter;
  traceCollection?: GovernanceIngestTraceCollection;
  logCollection?: GovernanceIngestLogCollectionChannel;
  metricCollection?: GovernanceIngestMetricCollectionChannel;
};

function mountIngest(world: World = {}) {
  const findByIngestSecret = vi
    .fn<IngestionSourceService["findByIngestSecret"]>()
    .mockResolvedValue(world.source === void 0 ? SOURCE : world.source);
  const recordEventReceived = vi
    .fn<IngestionSourceService["recordEventReceived"]>()
    .mockResolvedValue(void 0);
  const traceCollectionMock = vi.fn<GovernanceIngestTraceCollection>().mockResolvedValue({
    rejectedSpans: 0,
  });

  const ingest = GovernanceIngestService.create({
    access: GovernanceIngestAccessService.create({
      sources: { findByIngestSecret },
      rateLimiter: world.rateLimiter ?? memoryRateLimiter(),
    }),
    receiver: GovernanceIngestReceiverService.create({
      sources: { recordEventReceived },
      costEvents: CanonicalCostExtractorService.create(),
      ottl: MemoryOttlTransformChannel.create(),
      projects: createApiFixture<ProjectApi>({
        ensureInternal: async ({ organizationId, kind }) => ({
          id: "gov_project",
          name: `Governance ${organizationId}`,
          slug: "gov-project",
          teamId: "team_gov",
          kind,
          archivedAtMs: null,
          traceSharingEnabled: false,
        }),
      }),
      traceCollection: world.traceCollection ?? traceCollectionMock,
      ...(world.logCollection ? { logCollection: world.logCollection } : {}),
      ...(world.metricCollection ? { metricCollection: world.metricCollection } : {}),
      spend: createApiFixture<GatewayApi>(),
      directory: GovernanceIngestPrincipalService.create({
        users: createApiFixture<UserApi>(),
        organizations: createApiFixture<OrganizationApi>(),
      }),
    }),
  });
  const app = createApiFixture<GovernanceRestApi>({
    ingestOtlpTraces: (input) => ingest.receiveOtlpTraces(input),
    ingestWebhook: (input) => ingest.receiveWebhook(input),
    ingestOtlpLogs: (input) => ingest.receiveOtlpLogs(input),
    ingestOtlpMetrics: (input) => ingest.receiveOtlpMetrics(input),
  });

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("the ingest receivers resolve their own credential.");
      },
    },
  });
  const hono = runtime.mount(governanceIngestRest.router(), {
    app: () => app,
    credential: "public",
    onError: renderHandled,
  });

  return {
    traceCollection: traceCollectionMock,
    ingestionSourceRecordEventReceived: recordEventReceived,
    findIngestionSourceByIngestSecret: findByIngestSecret,
    post: (path: string, body: string, headers: Record<string, string> = {}) =>
      hono.fetch(
        new Request(`http://api.test${path}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SECRET}`,
            "content-type": "application/json",
            ...headers,
          },
          body,
        }),
      ),
  };
}

const traceBody = JSON.stringify({
  resourceSpans: [{ scopeSpans: [{ spans: [{ name: "one", attributes: [] }] }] }],
});

const metricBody = JSON.stringify({
  resourceMetrics: [
    { scopeMetrics: [{ metrics: [{ name: "m", sum: { dataPoints: [{ asInt: "1" }] } }] }] },
  ],
});

describe("the ingestion-source receivers", () => {
  describe("given a bearer no ingestion source's secret matches", () => {
    it("refuses with the bare unauthorized body and reads no pipeline", async () => {
      const api = mountIngest({ source: null });

      const response = await api.post(`/api/ingest/otel/${SOURCE_ID}`, traceBody);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        code: "ingestion_source_unauthorized",
      });
      expect(api.traceCollection).not.toHaveBeenCalled();
    });
  });

  describe("given a valid secret pointed at another source's endpoint", () => {
    it("answers the same bare 401, so the reply never confirms the other id exists", async () => {
      const api = mountIngest();

      const response = await api.post("/api/ingest/otel/src_other", traceBody);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        code: "ingestion_source_unauthorized",
      });
      expect(api.traceCollection).not.toHaveBeenCalled();
    });
  });

  describe("when the per-caller throttle refuses", () => {
    it("sheds at the edge with Retry-After, before the secret lookup", async () => {
      const api = mountIngest({
        rateLimiter: { check: async () => ({ allowed: false, retryAfterSeconds: 30 }) },
      });

      const response = await api.post(`/api/ingest/otel/${SOURCE_ID}`, traceBody);

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("30");
      expect(api.findIngestionSourceByIngestSecret).not.toHaveBeenCalled();
    });
  });

  describe("given a source type the OTLP path does not serve", () => {
    it("answers wrong_endpoint and hands nothing to the trace pipeline", async () => {
      const api = mountIngest({ source: { ...SOURCE, sourceType: "workato" } });

      const response = await api.post(`/api/ingest/otel/${SOURCE_ID}`, traceBody);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "ingestion_wrong_endpoint" });
      expect(api.traceCollection).not.toHaveBeenCalled();
    });
  });

  describe("when a span batch arrives for a source that serves it", () => {
    it("acknowledges it and stamps receiver-authoritative origin attributes", async () => {
      const api = mountIngest();

      const response = await api.post(`/api/ingest/otel/${SOURCE_ID}`, traceBody);

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({ accepted: true, events: 1 });

      const handed = api.traceCollection.mock.calls[0]?.[0] as
        | {
            tenantId: string;
            traceRequest: {
              resourceSpans: { scopeSpans: { spans: { attributes: { key: string }[] }[] }[] }[];
            };
          }
        | undefined;

      expect(handed?.tenantId).toBe("gov_project");
      expect(handed?.traceRequest.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.attributes).toEqual(
        expect.arrayContaining([
          { key: "langwatch.origin.kind", value: { stringValue: "ingestion_source" } },
          { key: "langwatch.ingestion_source.id", value: { stringValue: SOURCE_ID } },
        ]),
      );
      expect(api.ingestionSourceRecordEventReceived).toHaveBeenCalledWith(SOURCE_ID);
    });
  });

  describe("given a deployment that folds no logs anywhere", () => {
    it("answers a permanent 404 rather than a status an exporter would retry", async () => {
      const api = mountIngest();

      const response = await api.post(`/api/ingest/otel/${SOURCE_ID}/v1/logs`, "{}");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        code: "ingestion_signal_not_served",
      });
      expect(api.ingestionSourceRecordEventReceived).not.toHaveBeenCalled();
    });

    it("refuses the webhook receiver the same way", async () => {
      const api = mountIngest();

      const response = await api.post(`/api/ingest/webhook/${SOURCE_ID}`, "{}");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        code: "ingestion_signal_not_served",
      });
    });
  });

  describe("given a deployment that folds no metrics anywhere", () => {
    it("answers a permanent 404, not a retryable one", async () => {
      const api = mountIngest();

      const response = await api.post(`/api/ingest/otel/${SOURCE_ID}/v1/metrics`, metricBody);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        code: "ingestion_signal_not_served",
      });
    });
  });

  describe("when the metric pipeline is momentarily unavailable", () => {
    it("answers 503 and records no source event, so the retry cannot double-count", async () => {
      const metricCollection = vi.fn().mockResolvedValue({
        outcome: "unavailable",
        errorMessage: "queue down",
        rejectedDataPoints: 0,
        acceptedDataPoints: 0,
      });
      const api = mountIngest({ metricCollection });

      const response = await api.post(`/api/ingest/otel/${SOURCE_ID}/v1/metrics`, metricBody);

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: "ingestion_receiver_unavailable",
      });
      expect(api.ingestionSourceRecordEventReceived).not.toHaveBeenCalled();
    });
  });

  describe("when a webhook envelope arrives for a source that serves it", () => {
    it("hands ONE log record to the log pipeline and acknowledges the envelope", async () => {
      const logCollection = vi.fn().mockResolvedValue(void 0);
      const api = mountIngest({ source: { ...SOURCE, sourceType: "workato" }, logCollection });

      const response = await api.post(`/api/ingest/webhook/${SOURCE_ID}`, '{"event":"run"}');

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({ accepted: true, bytes: 15 });
      expect(logCollection).toHaveBeenCalledTimes(1);
      expect(api.ingestionSourceRecordEventReceived).toHaveBeenCalledWith(SOURCE_ID);
    });
  });
});
