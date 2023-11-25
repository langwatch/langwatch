import { describe, expect, it } from "vitest";
import { ToxicityCheck } from "./toxicityCheck";
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

    const response = await ToxicityCheck.execute(sampleTrace, []);
    const raw_result = response.raw_result as ModerationResult;
    expect(raw_result.results[0]?.categories.harassment).toBe(true);
    expect(response.value).toBeGreaterThan(0.9);
    expect(response.status).toBe("failed");
  });
});
