import { describe, expect, it } from "vitest";
import { CanonicalLogAdapter } from "../canonical-log.adapter";
import type { LogPreparationInput } from "../../ports/log-preparation.port";
import type { LogRedactionPort } from "../../ports/log-redaction.port";
import type { AppendStore } from "@langwatch/eventing";
import {
  DEFAULT_LOG_COMMAND_SHARDS,
  MAX_LOG_COMMAND_SHARDS,
  MIN_LOG_COMMAND_SHARDS,
  canonicalLogRecordReceivedEventSchema,
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
  type CanonicalLogRecord,
} from "@langwatch/log-contract";
import { CanonicalLogStorageMapProjection } from "../../projections/canonical-log-storage.projection";

const noRedaction: LogRedactionPort = {
  redactLog: async () => undefined,
};

function prepareCanonicalLogRecords(
  input: LogPreparationInput,
  redaction: LogRedactionPort = noRedaction,
) {
  return CanonicalLogAdapter.create({ redaction }).prepare(input);
}

function request(logRecords: unknown[], scopeName = "test.scope") {
  return {
    resourceLogs: [
      {
        schemaUrl: "resource.schema",
        resource: {
          droppedAttributesCount: 2,
          attributes: [{ key: "service.name", value: { stringValue: "worker" } }],
        },
        scopeLogs: [
          {
            schemaUrl: "scope.schema",
            scope: {
              name: scopeName,
              version: "1.2.3",
              attributes: [{ key: "scope.enabled", value: { boolValue: true } }],
            },
            logRecords,
          },
        ],
      },
    ],
  };
}

async function prepare(logRecords: unknown[], scopeName?: string) {
  return prepareCanonicalLogRecords({
    tenantId: "project_test",
    organizationId: "organization_test",
    request: request(logRecords, scopeName),
    piiRedactionLevel: "DISABLED",
    acceptedAt: 1_700_000_000_000,
  });
}

describe("canonical log preparation", () => {
  it("preserves typed OTLP values and produces a deterministic content id", async () => {
    const log = {
      traceId: "00112233445566778899aabbccddeeff",
      spanId: "0011223344556677",
      timeUnixNano: "1700000000123456789",
      observedTimeUnixNano: "1700000000223456789",
      severityNumber: 13,
      severityText: "WARN",
      body: {
        kvlistValue: {
          values: [
            { key: "answer", value: { intValue: "9223372036854775807" } },
            { key: "ok", value: { boolValue: true } },
          ],
        },
      },
      attributes: [
        {
          key: "nested",
          value: {
            arrayValue: {
              values: [{ doubleValue: 1.5 }, { bytesValue: new Uint8Array([1, 2, 3]) }],
            },
          },
        },
      ],
    };
    const first = await prepare([log]);
    const second = await prepare([structuredClone(log)]);

    expect(first.rejectedLogRecords).toBe(0);
    expect(first.accepted[0]!.record).toMatchObject({
      bodyType: "kvlist",
      correlationSource: "wire",
      wireTraceId: log.traceId,
      correlationTraceId: log.traceId,
      timeUnixNano: log.timeUnixNano,
    });
    expect(first.accepted[0]!.record.recordId).toBe(second.accepted[0]!.record.recordId);
    expect(JSON.parse(first.accepted[0]!.record.bodyJson)).toEqual({
      type: "kvlist",
      value: [
        { key: "answer", value: { type: "int", value: "9223372036854775807" } },
        { key: "ok", value: { type: "bool", value: true } },
      ],
    });
  });

  it("redacts nested string values before hashing or storage", async () => {
    const result = await prepareCanonicalLogRecords(
      {
        tenantId: "project_test",
        organizationId: "organization_test",
        request: request([
          {
            body: {
              kvlistValue: {
                values: [
                  {
                    key: "email",
                    value: { stringValue: "person@example.com" },
                  },
                ],
              },
            },
          },
        ]),
        piiRedactionLevel: "STRICT",
        acceptedAt: 1_700_000_000_000,
      },
      {
        redactLog: async (log) => {
          for (const key of Object.keys(log.attributes)) {
            log.attributes[key] = "[REDACTED]";
          }
        },
      },
    );

    expect(result.accepted[0]!.record.canonicalPayload).not.toContain("person@example.com");
    expect(result.accepted[0]!.record.canonicalPayload).toContain("[REDACTED]");
  });

  /** @scenario "A credential-named log attribute is redacted by name" */
  it("hands the redactor each attribute's real name, not just its path", async () => {
    let seen: Record<string, string> | undefined;
    await prepareCanonicalLogRecords(
      {
        tenantId: "project_test",
        organizationId: "organization_test",
        request: request([
          {
            attributes: [
              { key: "authorization", value: { stringValue: "Bearer zzz" } },
              {
                key: "langwatch.api_key.id",
                value: { stringValue: "key_abc123" },
              },
            ],
          },
        ]),
        piiRedactionLevel: "STRICT",
        acceptedAt: 1_700_000_000_000,
      },
      {
        redactLog: async (log) => {
          seen = log.attributeNames;
        },
      },
    );

    // The keys stay JSON paths, because two attributes may share a name and
    // each value still needs its own address. The names ride alongside.
    expect(Object.values(seen ?? {})).toEqual(
      expect.arrayContaining(["authorization", "langwatch.api_key.id"]),
    );
    expect(Object.keys(seen ?? {})).toEqual(
      expect.arrayContaining([expect.stringContaining("value.stringValue")]),
    );
  });

  it("keeps wire ids separate when synthesizing provider correlation", async () => {
    const result = await prepare(
      [
        {
          timeUnixNano: "1700000000000000000",
          body: { stringValue: "event" },
          attributes: [
            { key: "event.name", value: { stringValue: "api_request" } },
            { key: "event.sequence", value: { intValue: "4" } },
            { key: "session.id", value: { stringValue: "session-1" } },
            { key: "prompt.id", value: { stringValue: "prompt-2" } },
          ],
        },
      ],
      "com.anthropic.claude_code.events",
    );
    const record = result.accepted[0]!.record;
    expect(record).toMatchObject({
      wireTraceId: "",
      wireSpanId: "",
      correlationSource: "claude_synthesized",
      providerKind: "claude_code",
      // The generic log pipeline no longer classifies claude span-kinds
      // (ADR-056 §7) — providerEventKind is empty for every record now.
      providerEventKind: "",
    });
    expect(record.correlationTraceId).toMatch(/^[a-f0-9]{32}$/);
    expect(record.correlationSpanId).toMatch(/^[a-f0-9]{16}$/);
  });

  it("uses the OTLP eventName field for provider correlation when the attribute is absent", async () => {
    const result = await prepare([
      {
        eventName: "codex.user_prompt",
        body: { stringValue: "event" },
        attributes: [
          {
            key: "conversation.id",
            value: { stringValue: "conversation-1" },
          },
        ],
      },
    ]);
    expect(result.accepted[0]!.record).toMatchObject({
      eventName: "codex.user_prompt",
      providerKind: "codex",
      correlationSource: "codex_synthesized",
    });
    expect(result.accepted[0]!.normalized.attributes["event.name"]).toBe("codex.user_prompt");
  });

  it("isolates malformed and oversized siblings as partial success", async () => {
    const result = await prepare([
      { body: { stringValue: "accepted" } },
      { body: { stringValue: "bad", boolValue: true } },
      { body: { stringValue: "x".repeat(1_100_000) } },
    ]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejectedLogRecords).toBe(2);
    expect(result.errors.join(" ")).toContain("multiple values");
    expect(result.errors.join(" ")).toContain("maximum");
  });

  it("rejects invalid unsigned counters instead of coercing them", async () => {
    const result = await prepare([{ body: { stringValue: "bad" }, droppedAttributesCount: -1 }]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejectedLogRecords).toBe(1);
  });

  describe("the shard count read from the environment", () => {
    it("uses the default when the variable is unset or empty", () => {
      expect(CanonicalLogAdapter.resolveLogCommandShardCount(void 0)).toBe(
        DEFAULT_LOG_COMMAND_SHARDS,
      );
      expect(CanonicalLogAdapter.resolveLogCommandShardCount("")).toBe(DEFAULT_LOG_COMMAND_SHARDS);
    });

    it("uses the default when the variable is not a number", () => {
      // A typo in a deploy variable must not decide the lane count.
      expect(CanonicalLogAdapter.resolveLogCommandShardCount("many")).toBe(
        DEFAULT_LOG_COMMAND_SHARDS,
      );
    });

    it("clamps to the bounds rather than trusting the value", () => {
      // Zero would make the lane modulo divide by zero; an enormous count
      // would fan one project's logs across lanes nothing consumes.
      expect(CanonicalLogAdapter.resolveLogCommandShardCount("0")).toBe(MIN_LOG_COMMAND_SHARDS);
      expect(CanonicalLogAdapter.resolveLogCommandShardCount("-4")).toBe(MIN_LOG_COMMAND_SHARDS);
      expect(CanonicalLogAdapter.resolveLogCommandShardCount("100000")).toBe(
        MAX_LOG_COMMAND_SHARDS,
      );
    });

    it("truncates a fractional count to a whole lane", () => {
      expect(CanonicalLogAdapter.resolveLogCommandShardCount("8.9")).toBe(8);
    });
  });

  it("keeps a lane inside the bounds even when handed a bad count directly", () => {
    // `logCommandGroupKey` clamps too, so a caller that skipped the resolver
    // still cannot divide by zero.
    expect(CanonicalLogAdapter.logCommandGroupKey("a".repeat(64), 0)).toBe("log:0");
  });

  it("assigns stable bounded command lanes", () => {
    expect(CanonicalLogAdapter.logCommandGroupKey("a".repeat(64), 16)).toBe(
      CanonicalLogAdapter.logCommandGroupKey("a".repeat(64), 16),
    );
    expect(
      Number(CanonicalLogAdapter.logCommandGroupKey("b".repeat(64), 16).split(":")[1]),
    ).toBeLessThan(16);
  });

  it("uses the canonical record id to shard map storage", () => {
    const record: CanonicalLogRecord = {
      tenantId: "project_test",
      organizationId: "organization_test",
      recordId: "a".repeat(64),
      resourceSchemaUrl: "",
      resourceAttributesJson: "[]",
      resourceAttributesFlatJson: "{}",
      resourceAttributeKeys: [],
      resourceDroppedAttributesCount: 0,
      scopeSchemaUrl: "",
      scopeName: "scope",
      scopeVersion: "",
      scopeAttributesJson: "[]",
      scopeAttributeKeys: [],
      scopeDroppedAttributesCount: 0,
      wireTraceId: "",
      wireSpanId: "",
      correlationTraceId: "",
      correlationSpanId: "",
      correlationSource: "none",
      timeUnixNano: "1",
      observedTimeUnixNano: "1",
      timeUnixMs: 1,
      severityNumber: 0,
      severityText: "",
      bodyType: "empty",
      bodyJson: '{"type":"empty"}',
      bodyText: null,
      attributesJson: "[]",
      attributesFlatJson: "{}",
      attributeKeys: [],
      droppedAttributesCount: 0,
      flags: 0,
      eventName: "",
      providerKind: "generic",
      providerEventKind: "",
      providerEventSequence: "",
      providerSessionId: "",
      providerConversationId: "",
      providerPromptId: "",
      piiRedactionLevel: "DISABLED",
      canonicalPayload: "{}",
      canonicalSizeBytes: 2,
      occurredAt: 1,
      acceptedAt: 1,
    };
    const event = canonicalLogRecordReceivedEventSchema.parse({
      id: "event",
      aggregateId: record.recordId,
      aggregateType: "log",
      tenantId: "project_test",
      createdAt: 1,
      occurredAt: 1,
      type: CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
      version: "2026-07-17",
      data: record,
    });
    const projection = CanonicalLogStorageMapProjection.create({
      store: {
        append: async (_record, _context) => undefined,
      } satisfies AppendStore<CanonicalLogRecord>,
      shardCount: 16,
    });

    expect(projection.options?.groupKeyFn?.(event)).toBe(
      CanonicalLogAdapter.logCommandGroupKey(record.recordId, 16),
    );
  });
});
