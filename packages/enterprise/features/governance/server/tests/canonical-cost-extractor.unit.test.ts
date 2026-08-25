/**
 * Unit tests for the post-OTTL canonical cost extractor.
 *
 * After the aigateway runs OTTL set/where statements over the OTLP
 * payload, the receiver reads ONLY `langwatch.*` attributes via this
 * extractor. The resource→record merge invariant must hold (resource
 * attrs flow through to per-record events) so admin-set
 * OTEL_RESOURCE_ATTRIBUTES (team.id, user.email overrides) reach the
 * ledger row.
 *
 * Spec: specs/ai-governance/ingestion-sources/claude-code-otlp.feature
 */

import { describe, expect, it } from "vitest";
import {
  CanonicalCostExtractorService,
  type OtlpFixed64,
  type OtlpKeyValue,
  type OtlpLogsRequest,
} from "../src/services/canonical-cost-extractor.service";

const extractor = CanonicalCostExtractorService.create();

type IKeyValue = OtlpKeyValue;
type IExportLogsServiceRequest = OtlpLogsRequest;

function strKv(key: string, value: string): IKeyValue {
  return { key, value: { stringValue: value } };
}

function intKv(key: string, value: number | string): IKeyValue {
  return { key, value: { intValue: value as never } };
}

function dblKv(key: string, value: number): IKeyValue {
  return { key, value: { doubleValue: value } };
}

function buildRequest(input: {
  resourceAttrs?: IKeyValue[];
  recordAttrs: IKeyValue[];
  timeUnixNano?: OtlpFixed64;
}): IExportLogsServiceRequest {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: input.resourceAttrs ?? [],
          droppedAttributesCount: 0,
        },
        scopeLogs: [
          {
            scope: { name: "test-scope", version: "1" },
            logRecords: [
              {
                timeUnixNano: input.timeUnixNano ?? "1714978800000000000",
                observedTimeUnixNano: input.timeUnixNano ?? "1714978800000000000",
                severityNumber: 9,
                severityText: "INFO",
                body: { stringValue: "" },
                attributes: input.recordAttrs,
                droppedAttributesCount: 0,
                traceId: new Uint8Array(0),
                spanId: new Uint8Array(0),
                flags: 0,
              } as never,
            ],
            schemaUrl: "",
          },
        ],
        schemaUrl: "",
      },
    ],
  } as unknown as IExportLogsServiceRequest;
}

describe("extractCanonicalCostEvents", () => {
  describe("happy path — all canonical fields present on the record", () => {
    it("emits one event with every field populated", () => {
      const events = extractor.extract(
        buildRequest({
          recordAttrs: [
            dblKv("langwatch.cost.usd", 0.12545),
            strKv("langwatch.request_id", "req_abc"),
            strKv("langwatch.model", "claude-opus-4-7"),
            intKv("langwatch.input_tokens", 1234),
            intKv("langwatch.output_tokens", 567),
            intKv("langwatch.cache_read_tokens", 200),
            intKv("langwatch.cache_creation_tokens", 10),
            strKv("langwatch.principal.email", "bob@acme.test"),
            strKv("langwatch.team.id_hint", "platform"),
          ],
        }),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        costUsd: "0.12545",
        requestId: "req_abc",
        model: "claude-opus-4-7",
        inputTokens: 1234,
        outputTokens: 567,
        cacheReadTokens: 200,
        cacheCreationTokens: 10,
        userEmail: "bob@acme.test",
        teamIdHint: "platform",
      });
    });
  });

  describe("when resource attributes carry team.id_hint and the record carries the rest", () => {
    it("merges resource → record so the ledger row sees both", () => {
      const events = extractor.extract(
        buildRequest({
          resourceAttrs: [strKv("langwatch.team.id_hint", "platform")],
          recordAttrs: [
            dblKv("langwatch.cost.usd", 0.04),
            strKv("langwatch.request_id", "req_xyz"),
            strKv("langwatch.model", "claude-sonnet-4-5"),
          ],
        }),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.teamIdHint).toBe("platform");
    });
  });

  describe("when record overrides resource for the same key", () => {
    it("prefers the record-level value (closer to the event)", () => {
      const events = extractor.extract(
        buildRequest({
          resourceAttrs: [strKv("langwatch.principal.email", "default@acme.test")],
          recordAttrs: [
            strKv("langwatch.principal.email", "actor@acme.test"),
            dblKv("langwatch.cost.usd", 0.01),
            strKv("langwatch.request_id", "req_z"),
          ],
        }),
      );
      expect(events[0]?.userEmail).toBe("actor@acme.test");
    });
  });

  describe("when langwatch.cost.usd is missing", () => {
    it("drops the event — no idempotent ledger write possible without cost", () => {
      const events = extractor.extract(
        buildRequest({
          recordAttrs: [strKv("langwatch.request_id", "req_no_cost")],
        }),
      );
      expect(events).toHaveLength(0);
    });
  });

  describe("when langwatch.request_id is missing", () => {
    it("drops the event — request_id is the idempotency key", () => {
      const events = extractor.extract(
        buildRequest({
          recordAttrs: [dblKv("langwatch.cost.usd", 0.01)],
        }),
      );
      expect(events).toHaveLength(0);
    });
  });

  describe("when intValue arrives as a string (OTLP/HTTP JSON wire)", () => {
    it("coerces string ints to number fields", () => {
      const events = extractor.extract(
        buildRequest({
          recordAttrs: [
            dblKv("langwatch.cost.usd", 0.05),
            strKv("langwatch.request_id", "req_str_int"),
            intKv("langwatch.input_tokens", "1234" as unknown as number),
            intKv("langwatch.output_tokens", "567" as unknown as number),
          ],
        }),
      );
      expect(events[0]?.inputTokens).toBe(1234);
      expect(events[0]?.outputTokens).toBe(567);
    });
  });

  describe("when timeUnixNano arrives as protobuf long bits", () => {
    it("preserves the unsigned 64-bit timestamp", () => {
      const nanos = 1_714_978_800_000_000_000n;
      const events = extractor.extract(
        buildRequest({
          timeUnixNano: {
            low: Number(nanos & 0xffff_ffffn),
            high: Number(nanos >> 32n),
          },
          recordAttrs: [
            dblKv("langwatch.cost.usd", 0.01),
            strKv("langwatch.request_id", "req_long_bits"),
          ],
        }),
      );

      expect(events[0]?.occurredAt).toEqual(new Date(Number(nanos / 1_000_000n)));
    });
  });

  describe("when langwatch.model is missing but cost + request_id present", () => {
    it("emits the event with model='unknown' (cost rolls up; admin can debug later)", () => {
      const events = extractor.extract(
        buildRequest({
          recordAttrs: [
            dblKv("langwatch.cost.usd", 0.03),
            strKv("langwatch.request_id", "req_unknown_model"),
          ],
        }),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.model).toBe("unknown");
    });
  });

  describe("when token fields are missing", () => {
    it("defaults to zero rather than dropping the event", () => {
      const events = extractor.extract(
        buildRequest({
          recordAttrs: [
            dblKv("langwatch.cost.usd", 0.001),
            strKv("langwatch.request_id", "req_no_tokens"),
          ],
        }),
      );
      expect(events[0]?.inputTokens).toBe(0);
      expect(events[0]?.outputTokens).toBe(0);
      expect(events[0]?.cacheReadTokens).toBe(0);
      expect(events[0]?.cacheCreationTokens).toBe(0);
    });
  });

  describe("when there are multiple records in one batch", () => {
    it("emits one event per qualifying record", () => {
      const req: IExportLogsServiceRequest = {
        resourceLogs: [
          {
            resource: {
              attributes: [strKv("service.name", "claude-code")],
              droppedAttributesCount: 0,
            },
            scopeLogs: [
              {
                scope: { name: "test", version: "1" },
                logRecords: [
                  {
                    timeUnixNano: "1",
                    observedTimeUnixNano: "1",
                    severityNumber: 9,
                    severityText: "INFO",
                    body: { stringValue: "" },
                    attributes: [
                      dblKv("langwatch.cost.usd", 0.01),
                      strKv("langwatch.request_id", "req_a"),
                    ],
                    droppedAttributesCount: 0,
                    traceId: new Uint8Array(0),
                    spanId: new Uint8Array(0),
                    flags: 0,
                  } as never,
                  {
                    timeUnixNano: "2",
                    observedTimeUnixNano: "2",
                    severityNumber: 9,
                    severityText: "INFO",
                    body: { stringValue: "" },
                    attributes: [
                      dblKv("langwatch.cost.usd", 0.02),
                      strKv("langwatch.request_id", "req_b"),
                    ],
                    droppedAttributesCount: 0,
                    traceId: new Uint8Array(0),
                    spanId: new Uint8Array(0),
                    flags: 0,
                  } as never,
                ],
                schemaUrl: "",
              },
            ],
            schemaUrl: "",
          },
        ],
      } as unknown as IExportLogsServiceRequest;
      const events = extractor.extract(req);
      expect(events.map((e) => e.requestId)).toEqual(["req_a", "req_b"]);
    });
  });
});
