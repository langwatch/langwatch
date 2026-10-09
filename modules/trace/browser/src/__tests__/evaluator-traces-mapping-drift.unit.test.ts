/**
 * trace-client copies dataset's mapping unions so a reader needs no dataset edge;
 * these assertions fail `tsc -b` (the package typecheck) the day either drifts.
 */
import type { MappingState } from "@langwatch/dataset-contract";
import type {
  EvaluatorTracesMappingProps,
  EvaluatorTracesMappingState,
} from "@langwatch/trace-client";
import { describe, expectTypeOf, it } from "vitest";

import type { EvaluatorTracesMapping } from "../ui/sections/evaluations/evaluator-traces-mapping.tsx";

describe("trace-client's copy of dataset's mapping state", () => {
  it("restates dataset's mapping state exactly", () => {
    expectTypeOf<EvaluatorTracesMappingState>().toExtend<MappingState>();
    expectTypeOf<MappingState>().toExtend<EvaluatorTracesMappingState>();
  });

  it("hands trace's mapping editor only props it accepts", () => {
    expectTypeOf<EvaluatorTracesMappingProps>().toExtend<
      Parameters<typeof EvaluatorTracesMapping>[0]
    >();
  });
});
