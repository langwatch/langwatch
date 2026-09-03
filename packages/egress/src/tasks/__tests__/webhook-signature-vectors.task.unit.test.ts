import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { serializeVectors, VECTORS_RELATIVE_PATH } from "../../webhook/signature-vectors";
import { WebhookSignatureVectorsTask } from "../webhook-signature-vectors.task";

describe("WebhookSignatureVectorsTask", () => {
  describe("given the task is run", () => {
    /** @scenario "A task runs by name with its arguments" */
    it("rewrites the committed vectors file to match the package's own generator", async () => {
      const task = WebhookSignatureVectorsTask.create();
      expect(task.name).toBe("webhook-signature-vectors");

      const controller = new AbortController();
      await task.run({ args: [], signal: controller.signal });

      const target = resolve(import.meta.dirname, "../../../../..", VECTORS_RELATIVE_PATH);
      const written = readFileSync(target, "utf8");
      expect(written).toBe(serializeVectors());
    });
  });
});
