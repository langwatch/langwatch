import type { NormalizedSpan } from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";

type StubSpanShape = Pick<
  NormalizedSpan,
  | "name"
  | "kind"
  | "instrumentationScope"
  | "statusMessage"
  | "statusCode"
  | "parentSpanId"
>;

type StubSpanOverrides = {
  name?: string;
  kind?: string | number | null;
  instrumentationScope?: { name: string; version?: string | null };
  statusMessage?: string | null;
  statusCode?: number | null;
  parentSpanId?: string | null;
};

/**
 * Builds the partial-NormalizedSpan stub that the canonicalisation tests pass
 * as the third argument to `service.canonicalize(...)`. Defaults match the
 * common "client SDK call" shape; override per-test as needed.
 *
 * Centralises the unavoidable type-narrowing cast — the runtime extractors
 * compare `kind` as a string (e.g. "CLIENT") even though the type is a numeric
 * enum, so a structural cast happens once here instead of at every call site.
 */
export function makeStubSpan(overrides: StubSpanOverrides = {}): StubSpanShape {
  return {
    name: "test",
    kind: "CLIENT",
    instrumentationScope: { name: "test", version: "1.0" },
    statusMessage: null,
    statusCode: null,
    parentSpanId: null,
    ...overrides,
  } as unknown as StubSpanShape;
}
