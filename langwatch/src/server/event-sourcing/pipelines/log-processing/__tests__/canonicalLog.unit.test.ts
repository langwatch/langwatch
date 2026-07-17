import { describe, expect, it } from "vitest";
import {
  logCommandGroupKey,
  prepareCanonicalLogRecords,
} from "../canonicalLog";

const noRedaction = {
  redactLog: async () => undefined,
};

function request(logRecords: unknown[], scopeName = "test.scope") {
  return {
    resourceLogs: [
      {
        schemaUrl: "resource.schema",
        resource: {
          droppedAttributesCount: 2,
          attributes: [
            { key: "service.name", value: { stringValue: "worker" } },
          ],
        },
        scopeLogs: [
          {
            schemaUrl: "scope.schema",
            scope: {
              name: scopeName,
              version: "1.2.3",
              attributes: [
                { key: "scope.enabled", value: { boolValue: true } },
              ],
            },
            logRecords,
          },
        ],
      },
    ],
  } as any;
}

async function prepare(logRecords: unknown[], scopeName?: string) {
  return prepareCanonicalLogRecords({
    tenantId: "project_test",
    organizationId: "organization_test",
    request: request(logRecords, scopeName),
    piiRedactionLevel: "DISABLED",
    redactionService: noRedaction,
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
              values: [
                { doubleValue: 1.5 },
                { bytesValue: new Uint8Array([1, 2, 3]) },
              ],
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
    expect(first.accepted[0]!.record.recordId).toBe(
      second.accepted[0]!.record.recordId,
    );
    expect(JSON.parse(first.accepted[0]!.record.bodyJson)).toEqual({
      type: "kvlist",
      value: [
        { key: "answer", value: { type: "int", value: "9223372036854775807" } },
        { key: "ok", value: { type: "bool", value: true } },
      ],
    });
  });

  it("redacts nested string values before hashing or storage", async () => {
    const result = await prepareCanonicalLogRecords({
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
      redactionService: {
        redactLog: async (log) => {
          for (const key of Object.keys(log.attributes)) {
            log.attributes[key] = "[REDACTED]";
          }
        },
      },
      acceptedAt: 1_700_000_000_000,
    });

    expect(result.accepted[0]!.record.canonicalPayload).not.toContain(
      "person@example.com",
    );
    expect(result.accepted[0]!.record.canonicalPayload).toContain("[REDACTED]");
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
      providerEventKind: "model",
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
    expect(result.accepted[0]!.normalized.attributes["event.name"]).toBe(
      "codex.user_prompt",
    );
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
    const result = await prepare([
      { body: { stringValue: "bad" }, droppedAttributesCount: -1 },
    ]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejectedLogRecords).toBe(1);
  });

  it("assigns stable bounded command lanes", () => {
    expect(logCommandGroupKey("a".repeat(64), 16)).toBe(
      logCommandGroupKey("a".repeat(64), 16),
    );
    expect(
      Number(logCommandGroupKey("b".repeat(64), 16).split(":")[1]),
    ).toBeLessThan(16);
  });
});
