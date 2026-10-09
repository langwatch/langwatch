/**
 * @vitest-environment node
 * `POST /api/otel/v1/metrics` against the COMPOSED metric app and the
 * MODULE-declared transport. Sibling of the trace door's composition test.
 */
import { gzipSync } from "node:zlib";

import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EventingCommands } from "@langwatch/eventing";
import { MetricApi, type CanonicalMetricDataPoint } from "@langwatch/metric-contract";
import { resolveRequestBound } from "@langwatch/plans";
import { LocalFeatureApis, type FeatureTransportDescriptor } from "@langwatch/process";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MetricModule } from "../../app/metric.app.ts";
import type { MetricProcessingPipeline } from "../../eventing/metric.pipeline.ts";
import { metricProcessModule } from "../../metric.module.ts";
import { MemoryMetricRepositories } from "../../repositories/memory/memory.metric.repositories.ts";
import { otlpMetricsRest } from "../otlp-metrics.rest.ts";

type Setup = Parameters<typeof MetricModule.create>[0];
type RecordDataPoint = EventingCommands<MetricProcessingPipeline>["recordDataPoint"];

const PROJECT = {
  id: "project-123",
  name: "Exporting Project",
  slug: "exporting-project",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
};
const TOKEN = "sk-lw-a-project-key";
const BULK_WIRE_CAP = resolveRequestBound("bodyLimitBulkBytes", "ENTERPRISE");
/** Past the shared reader's 10 MiB decompressed cap. */
const BOMB_EXPANDED_BYTES = 11 * 1024 * 1024;

/** The metric REST surface as boot mounts it, over one composed MetricModule. */
function deployment() {
  const sentPoints: CanonicalMetricDataPoint[] = [];

  const traces = createApiFixture<TraceApi>({
    otlpCredential: async () => ({
      project: PROJECT,
      identity: {
        apiKeyId: "api-key-1",
        organizationId: PROJECT.organizationId,
        ingestSourceType: null,
        ingestionTemplateId: null,
      },
    }),
    otlpUsageLimit: async () => undefined,
    otlpMarkCredentialUsed: () => undefined,
    recordMetricCorrelations: async () => undefined,
  });

  const app = MetricModule.create({
    dependencies: {
      traces,
      dataPrivacy: createApiFixture<DataPrivacyApi>({
        redactMetricAttributes: async () => undefined,
      }),
      // Read only by the pipeline's handlers, which this door never runs.
      retention: createApiFixture<DataRetentionApi>(),
    },
    repositories: MemoryMetricRepositories.create(),
    config: { processingShards: undefined },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: createApiFixture<Setup["secrets"]>(),
  });
  app.connectCommands(
    createApiFixture<EventingCommands<MetricProcessingPipeline>>({
      recordDataPoint: createApiFixture<RecordDataPoint>({
        sendBatch: async (points) => {
          sentPoints.push(...points);
        },
      }),
    }),
  );

  const apis = new LocalFeatureApis();
  apis.declare(MetricApi);
  apis.bind(MetricApi, app);
  apis.ready();

  const runtime = createRestRuntime({
    authorization: restTestAuthorization(),
    identity: {
      authenticate: () => {
        throw new Error("the ingestion doors resolve their own credential");
      },
    },
  });

  // Mounted only if `metric.module.ts` still declares the door.
  const declaredRest: readonly FeatureTransportDescriptor[] = metricProcessModule.transports ?? [];
  const mounted = declaredRest.includes(otlpMetricsRest)
    ? [
        runtime.mount(otlpMetricsRest.router(), {
          app: () => apis.reference(MetricApi),
          credential: "public",
          onError: canonicalErrorResponse,
        }),
      ]
    : [];

  const post = async ({
    body,
    headers = {},
  }: {
    body: RequestInit["body"];
    headers?: Record<string, string>;
  }) => {
    for (const family of mounted) {
      return family.request("/api/otel/v1/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Auth-Token": TOKEN, ...headers },
        body,
      });
    }
    return new Response(null, { status: 404 });
  };

  return { post, sentPoints };
}

/** One gauge data point, in the JSON shape an OTLP exporter posts it. */
function otlpMetricBody() {
  return JSON.stringify({
    resourceMetrics: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: "checkout" } }] },
        scopeMetrics: [
          {
            scope: { name: "langwatch-meter", version: "1.0.0" },
            metrics: [
              {
                name: "queue.depth",
                unit: "1",
                gauge: { dataPoints: [{ timeUnixNano: `${Date.now()}000000`, asDouble: 3 }] },
              },
            ],
          },
        ],
      },
    ],
  });
}

describe("given the metric module as a process composes it", () => {
  describe("when an OTLP exporter posts a metric batch to /api/otel/v1/metrics", () => {
    /** @scenario "An exported metric batch reaches the metric pipeline" */
    it("accepts the batch and sends its point on against the credential's project", async () => {
      const { post, sentPoints } = deployment();

      const response = await post({ body: otlpMetricBody() });

      expect([response.status, await response.json()]).toEqual([200, {}]);
      expect(sentPoints).toHaveLength(1);
      expect(sentPoints[0]).toMatchObject({ tenantId: PROJECT.id });
    });
  });

  describe("when a small gzip body expands past the decompressed cap", () => {
    /** @scenario "A metric export that decompresses past the cap is refused" */
    it("refuses it as too large and sends nothing on", async () => {
      const { post, sentPoints } = deployment();
      const bomb = gzipSync(Buffer.alloc(BOMB_EXPANDED_BYTES));

      const response = await post({
        body: bomb,
        headers: { "Content-Type": "application/x-protobuf", "Content-Encoding": "gzip" },
      });

      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ code: "ERR_PAYLOAD_TOO_LARGE" });
      expect(sentPoints).toHaveLength(0);
    });
  });

  describe("when the body on the wire is larger than the bulk cap", () => {
    /** @scenario "The metric door refuses a body over the wire cap" */
    it("refuses it as too large and sends nothing on", async () => {
      const { post, sentPoints } = deployment();

      const response = await post({
        body: new Uint8Array(BULK_WIRE_CAP + 1),
        headers: { "Content-Type": "application/x-protobuf" },
      });

      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ code: "payload_too_large" });
      expect(sentPoints).toHaveLength(0);
    });
  });

  describe.each(["application/grpc", "application/grpc+proto"])(
    "when a gRPC-framed export is posted under %s",
    (contentType) => {
      /** @scenario "A gRPC-framed export is refused with a clear answer" */
      it("refuses it with 415 unsupported_media_type and sends nothing on", async () => {
        const { post, sentPoints } = deployment();

        const response = await post({
          body: new Uint8Array(5),
          headers: { "Content-Type": contentType },
        });

        expect(response.status).toBe(415);
        expect(await response.json()).toMatchObject({ code: "unsupported_media_type" });
        expect(sentPoints).toHaveLength(0);
      });
    },
  );
});
