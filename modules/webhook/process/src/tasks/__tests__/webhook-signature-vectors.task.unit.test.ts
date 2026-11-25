import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  serializeVectors,
  VECTORS_RELATIVE_PATH,
} from "../../rules/webhook-signature-vectors.rules.ts";
import { WebhookSignatureVectorsTask } from "../webhook-signature-vectors.task.ts";

describe("WebhookSignatureVectorsTask", () => {
  describe("given the task is run", () => {
    /** @scenario "A task runs by name with its arguments" */
    it("rewrites the committed vectors file to match the package's own generator", async () => {
      const task = WebhookSignatureVectorsTask.create();
      expect(task.name).toBe("webhook-signature-vectors");

      const controller = new AbortController();
      await task.run({ args: [], signal: controller.signal });

      const target = resolve(import.meta.dirname, "../../../../../..", VECTORS_RELATIVE_PATH);
      const written = readFileSync(target, "utf8");
      expect(written).toBe(serializeVectors());
    });
  });

  describe("given the staged file cannot be renamed over the target", () => {
    const dirs: string[] = [];
    afterEach(() => {
      for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    /** @scenario "A task whose file write fails leaves no staged temporary file" */
    it("throws and leaves no .tmp file beside the target", async () => {
      const dir = mkdtempSync(join(tmpdir(), "webhook-vectors-"));
      dirs.push(dir);
      const target = join(dir, "vectors.json");
      mkdirSync(target);

      const task = WebhookSignatureVectorsTask.create({ target });
      await expect(
        task.run({ args: [], signal: new AbortController().signal }),
      ).rejects.toMatchObject({ code: "EISDIR" });

      expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    });
  });
});
