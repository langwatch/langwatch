/**
 * @vitest-environment node
 * `POST /api/otel/v1/logs` against the COMPOSED log app and the MODULE-declared
 * transport: the two caps, over the real receiver rather than a stub.
 */
import { gzipSync } from "node:zlib";

import { ProjectMissingCredentialsError } from "@langwatch/api";
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EventingCommands } from "@langwatch/eventing";
import { LogApi } from "@langwatch/log-contract";
import { resolveRequestBound } from "@langwatch/plans";
import { LocalFeatureApis, type FeatureTransportDescriptor } from "@langwatch/process";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { LogModule } from "../../app/log.app.ts";
import type { LogProcessingPipeline } from "../../eventing/log.pipeline.ts";
import { logProcessModule } from "../../log.module.ts";
import { MemoryLogRepositories } from "../../repositories/memory/memory.log.repositories.ts";
import { otlpLogsDoor, otlpLogsRest } from "../otlp-logs.rest.ts";

type Setup = Parameters<typeof LogModule.create>[0];
type RecordLogRecord = EventingCommands<LogProcessingPipeline>["recordLogRecord"];

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

/** The log REST surface as boot mounts it, over one composed LogModule. */
function deployment() {
  const sentRecords: unknown[] = [];

  const traces = createApiFixture<TraceApi>({
    otlpCredential: async ({ authorization, xAuthToken }) => {
      if (!authorization && !xAuthToken) throw new ProjectMissingCredentialsError();
      return {
        project: PROJECT,
        identity: {
          apiKeyId: "api-key-1",
          organizationId: PROJECT.organizationId,
          ingestSourceType: null,
          ingestionTemplateId: null,
        },
      };
    },
    otlpUsageLimit: async () => undefined,
    otlpMarkCredentialUsed: () => undefined,
  });

  const app = LogModule.create({
    dependencies: {
      traces,
      // Read only past the decode, which neither refusal reaches.
      dataPrivacy: createApiFixture<DataPrivacyApi>(),
      retention: createApiFixture<DataRetentionApi>(),
    },
    repositories: MemoryLogRepositories.create(),
    config: { processingShards: undefined },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: createApiFixture<Setup["secrets"]>(),
  });
  app.connectCommands(
    createApiFixture<EventingCommands<LogProcessingPipeline>>({
      recordLogRecord: createApiFixture<RecordLogRecord>({
        sendBatch: async (records) => {
          sentRecords.push(...records);
        },
      }),
    }),
  );

  const apis = new LocalFeatureApis();
  apis.declare(LogApi);
  apis.bind(LogApi, app);
  apis.ready();

  const runtime = createRestRuntime({
    doors: { otlp_ingest: otlpLogsDoor((input) => traces.otlpCredential(input)) },
    authorization: restTestAuthorization(),
    identity: {
      authenticate: () => {
        throw new Error("the ingestion doors resolve their own credential");
      },
    },
  });

  // Mounted only if `log.module.ts` still declares the door.
  const declaredRest: readonly FeatureTransportDescriptor[] = logProcessModule.transports ?? [];
  const mounted = declaredRest.includes(otlpLogsRest)
    ? [
        runtime.mount(otlpLogsRest.router(), {
          app: () => apis.reference(LogApi),
          credential: "otlp_ingest",
          onError: canonicalErrorResponse,
        }),
      ]
    : [];

  const post = async ({
    body,
    headers = {},
    path = "/api/otel/v1/logs",
  }: {
    body: RequestInit["body"];
    headers?: Record<string, string>;
    path?: string;
  }) => {
    for (const family of mounted) {
      return family.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Auth-Token": TOKEN, ...headers },
        body,
      });
    }
    return new Response(null, { status: 404 });
  };

  return { post, sentRecords };
}

describe("given the log module as a process composes it", () => {
  describe("when a small gzip body expands past the decompressed cap", () => {
    /** @scenario "A log export that decompresses past the cap is refused" */
    it("refuses it as too large and sends nothing on", async () => {
      const { post, sentRecords } = deployment();
      const bomb = gzipSync(Buffer.alloc(BOMB_EXPANDED_BYTES));

      const response = await post({
        body: bomb,
        headers: { "Content-Type": "application/x-protobuf", "Content-Encoding": "gzip" },
      });

      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ code: "ERR_PAYLOAD_TOO_LARGE" });
      expect(sentRecords).toHaveLength(0);
    });
  });

  describe("when the body on the wire is larger than the bulk cap", () => {
    /** @scenario "The log door refuses a body over the wire cap" */
    it("refuses it as too large and sends nothing on", async () => {
      const { post, sentRecords } = deployment();

      const response = await post({
        body: new Uint8Array(BULK_WIRE_CAP + 1),
        headers: { "Content-Type": "application/x-protobuf" },
      });

      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ code: "payload_too_large" });
      expect(sentRecords).toHaveLength(0);
    });
  });

  describe.each(["application/grpc", "application/grpc+proto"])(
    "when a gRPC-framed export is posted under %s",
    (contentType) => {
      /** @scenario "A gRPC-framed export is refused with a clear answer" */
      it("refuses it with 415 unsupported_media_type and sends nothing on", async () => {
        const { post, sentRecords } = deployment();

        const response = await post({
          body: new Uint8Array(5),
          headers: { "Content-Type": contentType },
        });

        expect(response.status).toBe(415);
        expect(await response.json()).toMatchObject({ code: "unsupported_media_type" });
        expect(sentRecords).toHaveLength(0);
      });
    },
  );

  describe("when an exporter posts to a path the receiver does not recognise", () => {
    /** @scenario "The log and metric doors refuse a missing key before they judge the exporter path" */
    it("refuses a missing key with 401 in the receiver's body before the path's 404", async () => {
      const { post, sentRecords } = deployment();
      const path = "/not-an-exporter/v1/logs";

      const anonymous = await post({ body: "{}", path, headers: { "X-Auth-Token": "" } });
      const keyed = await post({ body: "{}", path });

      expect(anonymous.status).toBe(401);
      expect(await anonymous.json()).toEqual({ message: expect.any(String) });
      expect(keyed.status).toBe(404);
      expect(sentRecords).toHaveLength(0);
    });
  });
});
