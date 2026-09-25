import { describe, expect, it, vi } from "vitest";

import { PersonalWorkspaceDiagnosticsService } from "../personal-workspace-diagnostics.service.ts";

describe("PersonalWorkspaceDiagnosticsService", () => {
  describe("when the organization service warns", () => {
    /** @scenario "A personal-workspace warning reaches the process logger" */
    it("passes the context first and the message second, the order the logger takes", () => {
      const warn = vi.fn();

      PersonalWorkspaceDiagnosticsService.create({ warn }).warn("personal workspace reused", {
        userId: "user_1",
      });

      expect(warn).toHaveBeenCalledWith({ userId: "user_1" }, "personal workspace reused");
    });
  });
});
