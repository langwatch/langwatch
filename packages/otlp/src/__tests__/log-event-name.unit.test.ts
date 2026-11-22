/**
 * Grok CLI names its log events only in LogRecord field 12 (`event_name`),
 * which the pinned decoder skips; the parse must still surface the name.
 * @see specs/ai-governance/ingestion-sources/grok-cli-otlp.feature
 */

import { describe, expect, it } from "vitest";

import { parseOtlpLogs } from "../body.ts";

function varint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return out;
}

function lengthDelimited(field: number, payload: number[]): number[] {
  return [...varint(field * 8 + 2), ...varint(payload.length), ...payload];
}

function text(field: number, value: string): number[] {
  return lengthDelimited(field, [...new TextEncoder().encode(value)]);
}

function logRecord({ eventName, severity }: { eventName?: string; severity: string }): number[] {
  return [
    ...varint(2 * 8), // field 2 (severity_number), varint wire type
    ...varint(9),
    ...text(3, severity),
    ...(eventName ? text(12, eventName) : []),
  ];
}

function scopeLogs(records: number[][]): number[] {
  return [
    ...lengthDelimited(1, text(1, "ai.xai.grok_code")),
    ...records.flatMap((record) => lengthDelimited(2, record)),
  ];
}

function requestBody(scopes: number[][][]): ArrayBuffer {
  const resourceLogs = scopes.flatMap((records) => lengthDelimited(2, scopeLogs(records)));
  return new Uint8Array(lengthDelimited(1, resourceLogs)).buffer as ArrayBuffer;
}

function decodedNames(body: ArrayBuffer): (string | undefined)[] {
  const parsed = parseOtlpLogs(body, "application/x-protobuf");
  if (!parsed.ok) throw new Error(parsed.error);
  return (parsed.request.resourceLogs ?? []).flatMap((resource) =>
    (resource.scopeLogs ?? []).flatMap((scope) =>
      (scope.logRecords ?? []).map((record) => (record as { eventName?: string }).eventName),
    ),
  );
}

describe("parseOtlpLogs", () => {
  describe("when log records carry the event name only in field 12", () => {
    /** @scenario "A protobuf log record named only in its event_name field keeps that name" */
    it("sets each record's eventName in wire order across scopes", () => {
      const body = requestBody([
        [
          logRecord({ eventName: "grok_code.user_prompt", severity: "INFO" }),
          logRecord({ severity: "INFO" }),
        ],
        [logRecord({ eventName: "grok_code.tool_result", severity: "INFO" })],
      ]);

      expect(decodedNames(body)).toEqual([
        "grok_code.user_prompt",
        undefined,
        "grok_code.tool_result",
      ]);
    });
  });

  describe("when the body is JSON", () => {
    /** @scenario "A JSON log record keeps the eventName it carries" */
    it("keeps the eventName the JSON already carries", () => {
      const json = {
        resourceLogs: [{ scopeLogs: [{ logRecords: [{ eventName: "grok_code.session_start" }] }] }],
      };
      const body = new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer;

      const parsed = parseOtlpLogs(body, "application/json");

      expect(
        parsed.ok && parsed.request.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords?.[0],
      ).toEqual({ eventName: "grok_code.session_start" });
    });

    // The field walk cannot read JSON bytes; it must give up without failing the parse.
    it("still parses it when the request labels it protobuf", () => {
      const json = {
        resourceLogs: [{ scopeLogs: [{ logRecords: [{ severityText: "INFO" }] }] }],
      };
      const body = new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer;

      const parsed = parseOtlpLogs(body, "application/x-protobuf");

      expect(parsed.ok).toBe(true);
      expect(
        parsed.ok && parsed.request.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords?.[0],
      ).toMatchObject({ severityText: "INFO" });
    });
  });
});
