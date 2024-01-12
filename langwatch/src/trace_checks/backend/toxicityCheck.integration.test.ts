import { describe, expect, it } from "vitest";
import { toxicityCheck } from "./toxicityCheck";
import type { Trace } from "../../server/tracer/types";
import type { ModerationResult } from "../types";

describe("ToxicityCheck", () => {
  it("detects toxicity on traces", async () => {
    const sampleTrace: Trace = {
      id: "foo",
      project_id: "foo",
      input: { value: "fuck you" },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
      search_embeddings: { openai_embeddings: [] },
    };

    const response = await toxicityCheck(sampleTrace, [], {
      categories: {
        hate: true,
        selfHarm: true,
        sexual: true,
        violence: true,
      },
    });
    const raw_result = response.raw_result as ModerationResult;
    expect(raw_result.categoriesAnalysis[0]?.category).toBe("Hate");
    expect(raw_result.categoriesAnalysis[0]?.severity).toBe(2);
    expect(response.value).toBeGreaterThan(0.9);
    expect(response.status).toBe("failed");
  });

  it("does not check for toxicity in categories that are not marked", async () => {
    const sampleTrace: Trace = {
      id: "foo",
      project_id: "foo",
      input: { value: "fuck you" },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
      search_embeddings: { openai_embeddings: [] },
    };

    const response = await toxicityCheck(sampleTrace, [], {
      categories: {
        hate: false,
        selfHarm: true,
        sexual: true,
        violence: true,
      },
    });
    const raw_result = response.raw_result as ModerationResult;
    expect(raw_result.categoriesAnalysis[0]?.category).not.toBe("Hate");
    expect(response.value).toBeLessThan(0.1);
    expect(response.status).toBe("succeeded");
  });
});
