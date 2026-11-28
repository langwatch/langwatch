/**
 * @vitest-environment node
 * The OTLP trace receiver's body cap is the deployment's setting: an export past the old 10 MiB
 * limit reaches the trace API whole, and one past the setting is refused before it is read.
 * Spec: specs/trace-processing/trace-media-blob-extraction.feature
 */
import { gzipSync } from "node:zlib";

import { createRestRuntime } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { type OtlpIngestCredential } from "@langwatch/otlp/door";
import { LocalFeatureApis } from "@langwatch/process";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import {
  DEFAULT_OTLP_TRACES_MAX_BODY_BYTES,
  TraceApi,
  type OtlpTracesInput,
} from "@langwatch/trace-contract";
import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it } from "vitest";

import { otlpIngestDoor, otlpIngestRest } from "../otlp-ingest.rest.ts";

const MiB = 1024 * 1024;
const PROJECT = { id: "project-123", teamId: "team-1", organizationId: "organization-1" };

const renderRefusal: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();
    return c.json({ code: serialized.code }, serialized.httpStatus as ContentfulStatusCode);
  }
  return c.json({ error: "Internal server error" }, 500);
};

function receiver({ maxBodyBytes }: { maxBodyBytes: number }) {
  const received: OtlpTracesInput[] = [];
  const credential: OtlpIngestCredential = {
    project: PROJECT,
    identity: {
      apiKeyId: "key_real",
      organizationId: PROJECT.organizationId,
      ingestSourceType: null,
      ingestionTemplateId: null,
    },
  };
  const apis = new LocalFeatureApis();
  apis.declare(TraceApi);
  apis.bind(
    TraceApi,
    createApiFixture<TraceApi>({
      otlpCredential: async () => credential,
      otlpMarkCredentialUsed: () => undefined,
      otlpUsageLimit: async () => undefined,
      otlpTracesMaxBodyBytes: () => maxBodyBytes,
      otlpTraces: async (input) => {
        received.push(input);
        return {};
      },
    }),
  );
  apis.ready();
  const family = createRestRuntime({
    doors: { otlp_ingest: otlpIngestDoor.open(apis.reference(TraceApi)) },
    authorization: restTestAuthorization(),
    identity: { authenticate: () => ({ authenticated: false }) as never },
  }).mount(otlpIngestRest.router(), {
    app: () => apis.reference(TraceApi),
    credential: "otlp_ingest",
    onError: renderRefusal,
  });
  const post = (body: Uint8Array | string, headers: Record<string, string> = {}) =>
    family.request("/api/otel/v1/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Auth-Token": "sk-lw-ingest", ...headers },
      body,
    });
  return { post, received };
}

/** One span whose attribute carries `bytes` of base64 audio, as a recording exporter sends it. */
function exportWithAudio(bytes: number): string {
  return JSON.stringify({
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: [
              {
                traceId: "b2ca0e1d9f4a4d2ab1c0d3e4f5061728",
                spanId: "a1b2c3d4e5f60718",
                name: "call",
                startTimeUnixNano: "1720000000000000000",
                endTimeUnixNano: "1720000001000000000",
                attributes: [
                  {
                    key: "gen_ai.input.messages",
                    value: { stringValue: `data:audio/mpeg;base64,${"A".repeat(bytes)}` },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}

describe("given the trace receiver on the default body cap", () => {
  describe("when an export past the old 10 MiB limit arrives", () => {
    /** @scenario "A trace export carrying an hour of compressed audio reaches extraction" */
    it("hands the whole export to the trace API", async () => {
      const { post, received } = receiver({ maxBodyBytes: DEFAULT_OTLP_TRACES_MAX_BODY_BYTES });
      const body = exportWithAudio(40 * MiB);

      const response = await post(body);

      expect(response.status).toBe(200);
      expect(received).toHaveLength(1);
      const attribute =
        received[0]?.traceRequest.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0]?.attributes?.[0]
          ?.value?.stringValue;
      expect(attribute?.length).toBe(`data:audio/mpeg;base64,`.length + 40 * MiB);
    });
  });
});

describe("given a deployment that sets a smaller body cap", () => {
  describe("when an export larger than the setting arrives", () => {
    /** @scenario "A trace export over the deployment's body cap is refused" */
    it("refuses it as too large and hands nothing on", async () => {
      const { post, received } = receiver({ maxBodyBytes: 2 * MiB });

      const response = await post(exportWithAudio(3 * MiB));

      expect(response.status).toBe(413);
      expect(received).toHaveLength(0);
    });
  });

  describe("when a small compressed export expands past the setting", () => {
    /** @scenario "A trace export over the deployment's body cap is refused" */
    it("refuses it as too large and hands nothing on", async () => {
      const { post, received } = receiver({ maxBodyBytes: 2 * MiB });

      const response = await post(gzipSync(Buffer.from(exportWithAudio(3 * MiB))), {
        "Content-Encoding": "gzip",
      });

      expect(response.status).toBe(413);
      expect(received).toHaveLength(0);
    });
  });
});
