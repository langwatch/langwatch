import { describe, expect, it, vi } from "vitest";

import { SystemMigrationsPassRequestTask } from "../system-migrations-pass-request.task.ts";

describe("SystemMigrationsPassRequestTask", () => {
  describe("when an upgrade finishes and runs the task", () => {
    /** @scenario "Finishing an upgrade requests one system-migrations pass" */
    it("asks the worker for exactly one pass and returns without waiting for it", async () => {
      const request = vi.fn().mockResolvedValue(undefined);
      const task = SystemMigrationsPassRequestTask.create({ request });

      expect(task.name).toBe("request-system-migrations-pass");
      await task.run();

      expect(request).toHaveBeenCalledTimes(1);
    });
  });
});
