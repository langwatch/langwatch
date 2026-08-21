import { describe, expect, it } from "vitest";
import type { TriggerFilters } from "~/server/filters/types";
import { diagnoseAutomationReachability } from "../automation-reachability";

function diagnoseStructured(filters: TriggerFilters) {
  return diagnoseAutomationReachability({ filters, filterQuery: null });
}

describe("diagnoseAutomationReachability", () => {
  it("flags actionable structured fields that the dispatch matcher fails closed", () => {
    expect(diagnoseStructured({ "metadata.key": ["environment"] })).toEqual({
      status: "unreachable",
      reasons: [
        {
          code: "unsupported_structured_fields",
          fields: ["metadata.key"],
        },
      ],
    });
  });

  it("does not flag an empty unsupported structured condition", () => {
    expect(diagnoseStructured({ "metadata.key": [] })).toBeNull();
  });

  it("flags an evaluation state outside the canonical run-state domain", () => {
    expect(
      diagnoseStructured({
        "evaluations.state": { evaluator_1: ["finished"] },
      }),
    ).toEqual({
      status: "unreachable",
      reasons: [
        {
          code: "invalid_evaluation_state",
          fields: ["evaluations.state"],
        },
      ],
    });
  });

  it("keeps a state filter reachable when any configured state is valid", () => {
    expect(
      diagnoseStructured({
        "evaluations.state": {
          evaluator_1: ["finished", "processed"],
        },
      }),
    ).toBeNull();
  });

  it("flags every query field that the real dispatch evaluator cannot read", () => {
    expect(
      diagnoseAutomationReachability({
        filters: {},
        filterQuery: "status:error OR (spanType:llm AND size:>100)",
      }),
    ).toEqual({
      status: "unreachable",
      reasons: [
        {
          code: "unsupported_filter_query_fields",
          fields: ["spanType", "size"],
        },
      ],
    });
  });

  it("does not confuse a supported query with a query that cannot fire", () => {
    expect(
      diagnoseAutomationReachability({
        filters: {},
        filterQuery: "status:error AND evaluatorStatus:processed",
      }),
    ).toBeNull();
  });

  it("flags a saved query that the compiler rejects", () => {
    expect(
      diagnoseAutomationReachability({
        filters: {},
        filterQuery: "fieldThatDoesNotExist:value",
      }),
    ).toEqual({
      status: "unreachable",
      reasons: [{ code: "invalid_filter_query", fields: [] }],
    });
  });
});
