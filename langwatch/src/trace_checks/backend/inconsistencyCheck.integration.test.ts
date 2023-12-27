import { describe, expect, it } from "vitest";
import { InconsistencyCheck } from "./inconsistencyCheck";
import type { Trace } from "../../server/tracer/types";
import type { InconsistencyCheckResult } from "../types";

describe("InconsistencyCheck", () => {
  it("detects inconsistencies in traces", async () => {
    const sampleTrace: Trace = {
      id: "foo",
      project_id: "foo",
      input: {
        value:
          "The grass is green. The house is red. The sky is blue. What is true?",
      },
      output: { value: "The grass is blue. The house is red." },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
      search_embeddings: {},
    };

    const response = await InconsistencyCheck.execute(sampleTrace, [], {});
    expect(
      (response.raw_result as InconsistencyCheckResult).sentences
    ).toContain("The grass is blue.");
    expect(response.value).toBe(1);
    expect(response.status).toBe("failed");
  });

  it("succeeds with no inconsistencies in traces", async () => {
    const sampleTrace: Trace = {
      id: "bar",
      project_id: "bar",
      input: { value: "The sky is clear. The car is new." },
      output: { value: "The sky is clear. The car is new." },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
      search_embeddings: {},
    };

    const response = await InconsistencyCheck.execute(sampleTrace, [], {});
    expect(
      (response.raw_result as InconsistencyCheckResult).sentences
    ).toHaveLength(0);
    expect(response.value).toBe(0);
    expect(response.status).toBe("succeeded");
  });
});
