import { parse, type TagToken } from "liqe";
import { describe, expect, it } from "vitest";
import type { TraceSummaryData } from "~/server/domain/traces/types";
import { FIELD_DEFS, KNOWN_FIELDS } from "../build-handlers";
import { type FieldDef, type InMemoryTrace, UNSUPPORTED } from "../field-def";

const summary = {
  traceId: "trace-1",
  spanCount: 1,
  totalDurationMs: 0,
  computedIOSchemaVersion: "1",
  computedInput: null,
  computedOutput: null,
  timeToFirstTokenMs: null,
  timeToLastTokenMs: null,
  tokensPerSecond: null,
  containsErrorStatus: false,
  containsOKStatus: true,
  errorMessage: null,
  models: [],
  totalCost: null,
  nonBilledCost: null,
  tokensEstimated: false,
  totalPromptTokenCount: null,
  totalCompletionTokenCount: null,
  outputFromRootSpan: false,
  outputSpanEndTimeMs: 0,
  blockedByGuardrail: false,
  rootSpanType: null,
  containsAi: false,
  containsPrompt: false,
  selectedPromptId: null,
  selectedPromptSpanId: null,
  selectedPromptStartTimeMs: null,
  lastUsedPromptId: null,
  lastUsedPromptVersionNumber: null,
  lastUsedPromptVersionId: null,
  lastUsedPromptSpanId: null,
  lastUsedPromptStartTimeMs: null,
  topicId: null,
  subTopicId: null,
  annotationIds: [],
  attributes: {},
  traceName: "",
  occurredAt: 0,
  createdAt: 0,
  updatedAt: 0,
  LastEventOccurredAt: 0,
} satisfies TraceSummaryData;

// A minimal fixture with every auxiliary collection loaded (but empty), so
// cross-table reads execute rather than short-circuit to UNSUPPORTED.
const minimalTrace: InMemoryTrace = {
  summary,
  evaluations: [],
  events: [],
  spans: [],
};

// A single literal tag reused across all fields — `evaluateInMemory` only reads
// the value/operator, never the field name, so one tag exercises every def.
const tag = parse("field:1") as TagToken;

const fieldDefs = FIELD_DEFS as Record<string, FieldDef>;

describe("FIELD_DEFS", () => {
  it("wires exactly the known fields with no extras or omissions", () => {
    expect(new Set(Object.keys(FIELD_DEFS))).toEqual(new Set(KNOWN_FIELDS));
  });

  describe("when every known field is evaluated on a minimal fixture", () => {
    it.each(KNOWN_FIELDS)(
      "[%s] returns a boolean or UNSUPPORTED without throwing",
      (field) => {
        const def = fieldDefs[field];
        expect(def).toBeDefined();

        let result: boolean | typeof UNSUPPORTED;
        expect(() => {
          result = def!.evaluateInMemory(tag, false, minimalTrace);
        }).not.toThrow();

        expect(
          result! === true || result! === false || result! === UNSUPPORTED,
        ).toBe(true);
      },
    );
  });

  describe("when a field declares a ClickHouse compiler", () => {
    it.each(KNOWN_FIELDS)("[%s] exposes a callable toClickHouse", (field) => {
      expect(typeof fieldDefs[field]!.toClickHouse).toBe("function");
    });
  });
});
