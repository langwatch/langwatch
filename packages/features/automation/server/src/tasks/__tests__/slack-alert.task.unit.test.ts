import { describe, expect, it } from "vitest";
import { SlackAlertTask } from "../slack-alert.task";

describe("SlackAlertTask", () => {
  describe("given no webhook URL is supplied", () => {
    it("refuses to run without a destination", async () => {
      const task = SlackAlertTask.create();
      expect(task.name).toBe("slack-alert");

      const controller = new AbortController();
      await expect(task.run({ args: [], signal: controller.signal })).rejects.toThrow(
        /webhook URL/,
      );
    });
  });
});
