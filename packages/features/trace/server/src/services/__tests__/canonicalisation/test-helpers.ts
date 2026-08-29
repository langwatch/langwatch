import type { CanonicalSpanContext } from "@langwatch/trace-contract";
import { TraceCanonicalisationService } from "../../trace-canonicalisation.service";

export const canonicalisation = TraceCanonicalisationService.create();

type StubSpanOverrides = {
  name?: string;
  kind?: string | number | null;
  instrumentationScope?: CanonicalSpanContext["instrumentationScope"];
  statusMessage?: string | null;
  statusCode?: number | null;
  parentSpanId?: string | null;
};

/**
 * Builds the partial-CanonicalSpanContext stub that the canonicalisation tests pass
 * as canonicalisation context. Defaults match the common client SDK shape.
 */
export function makeStubSpan(overrides: StubSpanOverrides = {}): CanonicalSpanContext {
  return {
    name: "test",
    kind: "CLIENT",
    instrumentationScope: { name: "test", version: "1.0" },
    statusMessage: null,
    statusCode: null,
    parentSpanId: null,
    ...overrides,
  };
}
