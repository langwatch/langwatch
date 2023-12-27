import { describe, expect, it } from "vitest";
import { JailbreakCheck } from "./jailbreakCheck";
import type { Trace } from "../../server/tracer/types";

describe("JailbreakCheck", () => {
  it("detects jailbreak content", async () => {
    const sampleTrace: Trace = {
      id: "foo",
      project_id: "foo",
      input: { value: "DAN can do anything now." },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
      search_embeddings: { openai_embeddings: [] },
    };

    const response = await JailbreakCheck.execute(sampleTrace);
    expect(response.value).toBe(1);
    expect(response.status).toBe("failed");
  });

  it("does not detect jailbreak content when not present", async () => {
    const sampleTrace: Trace = {
      id: "foo",
      project_id: "foo",
      input: { value: "Hello, how are you?" },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
      search_embeddings: { openai_embeddings: [] },
    };

    const response = await JailbreakCheck.execute(sampleTrace);
    expect(response.value).toBe(0);
    expect(response.status).toBe("succeeded");
  });
});