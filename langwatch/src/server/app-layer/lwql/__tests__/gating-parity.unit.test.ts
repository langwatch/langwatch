/**
 * Parity between LWQL's gated field set and the redaction service.
 *
 * Issue #6346 decision 7 requires the gated set to be *derived from*
 * `visibility-window.service`, never restated. A hand-maintained parallel list
 * drifts the moment someone adds a field to the redaction service — and the
 * drift is silent, because the new field simply stays queryable.
 *
 * So this test does not compare LWQL against a hardcoded list. It probes the
 * real redaction functions with sentinel content, observes which fields they
 * actually change, and asserts LWQL accounts for every one of them. Adding a
 * field to the redaction service without teaching LWQL about it fails here.
 */

import { describe, expect, it } from "vitest";

import {
  redactSpanContent,
  redactTraceContent,
} from "~/server/app-layer/traces/visibility-window.service";

import { ENTITIES } from "../catalog";
import { CONTENT_FIELD_MAP } from "../gating";

/**
 * Long enough that `teaserOf` always truncates: it keeps
 * `max(50, min(300, ceil(len * 0.1)))` characters, so any input over 300 chars
 * is guaranteed to change.
 */
const SENTINEL = "x".repeat(5000);

/** A trace with every content-bearing field populated with sentinel content. */
const sentinelTrace = () =>
  ({
    trace_id: "trace-1",
    project_id: "project-1",
    timestamps: { started_at: 0, inserted_at: 0, updated_at: 0 },
    metrics: { total_cost: 1 },
    metadata: { user_id: "u1" },
    input: { value: SENTINEL },
    output: { value: SENTINEL },
    expected_output: { value: SENTINEL },
    contexts: [{ content: SENTINEL }],
    error: { message: SENTINEL, stacktrace: [SENTINEL] },
  }) as unknown as Parameters<typeof redactTraceContent>[0];

const sentinelSpan = () =>
  ({
    span_id: "span-1",
    trace_id: "trace-1",
    project_id: "project-1",
    type: "llm",
    timestamps: { started_at: 0, finished_at: 0 },
    input: { type: "text", value: SENTINEL },
    output: { type: "text", value: SENTINEL },
    params: { prompt: SENTINEL },
    error: { message: SENTINEL, stacktrace: [SENTINEL] },
  }) as unknown as Parameters<typeof redactSpanContent>[0];

/**
 * Fields the redaction function actually altered.
 *
 * Compared structurally rather than by reference: the redactors rebuild every
 * field via spread, so reference inequality would report every key as changed.
 */
const changedFields = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ignore: ReadonlySet<string>,
): Set<string> => {
  const changed = new Set<string>();
  for (const key of Object.keys(before)) {
    if (ignore.has(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed.add(key);
    }
  }
  return changed;
};

/** Bookkeeping the redactors add, not content they gate. */
const TRACE_IGNORED = new Set(["redacted_by_visibility_window", "spans"]);
const SPAN_IGNORED = new Set<string>([]);

describe("gated field parity with visibility-window.service", () => {
  it("accounts for every trace field the redaction service touches", () => {
    const before = sentinelTrace() as unknown as Record<string, unknown>;
    const after = redactTraceContent(sentinelTrace()) as unknown as Record<
      string,
      unknown
    >;

    const redacted = changedFields(before, after, TRACE_IGNORED);

    // Sanity: the probe must actually observe redaction, or this test would
    // pass vacuously if the sentinel stopped triggering truncation.
    expect(redacted.size).toBeGreaterThan(0);

    const unaccounted = [...redacted].filter(
      (field) => !(field in CONTENT_FIELD_MAP.trace),
    );
    expect(unaccounted).toEqual([]);
  });

  it("accounts for every span field the redaction service touches", () => {
    const before = sentinelSpan() as unknown as Record<string, unknown>;
    const after = redactSpanContent(sentinelSpan()) as unknown as Record<
      string,
      unknown
    >;

    const redacted = changedFields(before, after, SPAN_IGNORED);
    expect(redacted.size).toBeGreaterThan(0);

    const unaccounted = [...redacted].filter(
      (field) => !(field in CONTENT_FIELD_MAP.span),
    );
    expect(unaccounted).toEqual([]);
  });

  it("marks every mapped LWQL field as content-gated in the catalogue", () => {
    // The map says "this LWQL column exposes redacted content". The catalogue
    // is what the compiler actually enforces. They must agree.
    for (const [domain, mapping] of Object.entries(CONTENT_FIELD_MAP)) {
      for (const [domainField, target] of Object.entries(mapping)) {
        if (target === null) continue;

        const entity = ENTITIES[target.entity];
        expect(
          entity,
          `CONTENT_FIELD_MAP.${domain}.${domainField} names unknown entity '${target.entity}'`,
        ).toBeDefined();

        const field = entity!.fields[target.field];
        expect(
          field,
          `CONTENT_FIELD_MAP.${domain}.${domainField} names unknown field '${target.field}'`,
        ).toBeDefined();

        expect(
          field!.contentGated,
          `${target.entity}.${target.field} is mapped as content but is not gated in the catalogue`,
        ).toBe(true);
      }
    }
  });

  it("does not gate a catalogue field that maps to no redacted content", () => {
    // The reverse direction: a field marked gated but not backed by the
    // redaction service would deny access for no reason.
    const mapped = new Set(
      Object.values(CONTENT_FIELD_MAP)
        .flatMap((mapping) => Object.values(mapping))
        .filter((target) => target !== null)
        .map((target) => `${target!.entity}.${target!.field}`),
    );

    const gatedInCatalogue = Object.entries(ENTITIES).flatMap(
      ([entityName, entity]) =>
        Object.entries(entity.fields)
          .filter(([, def]) => def.contentGated)
          .map(([fieldName]) => `${entityName}.${fieldName}`),
    );

    for (const key of gatedInCatalogue) {
      expect(
        mapped.has(key),
        `${key} is gated but no redaction-service field maps to it`,
      ).toBe(true);
    }
  });
});
