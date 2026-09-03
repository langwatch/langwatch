import { describe, expect, it } from "vitest";
import { ModelRegistrySyncTask } from "../model-registry-sync.task";

describe("ModelRegistrySyncTask", () => {
  it("is named model-registry-sync", () => {
    const task = ModelRegistrySyncTask.create({ apiKey: () => "sk-or-test" });
    expect(task.name).toBe("model-registry-sync");
  });

  describe("when no OpenRouter API key is configured", () => {
    it("refuses to run", async () => {
      const task = ModelRegistrySyncTask.create({ apiKey: () => undefined });
      const controller = new AbortController();

      await expect(task.run({ args: [], signal: controller.signal })).rejects.toThrow(
        "OPENROUTER_API_KEY environment variable is not set",
      );
    });
  });
});
