import { describe, expect, it, vi } from "vitest";
import { ApiKeyDiagnosticsAdapter } from "../api-key-diagnostics.adapter";

describe("ApiKeyDiagnosticsAdapter", () => {
  describe("when the legacy grant service warns", () => {
    /** @scenario "An API-key grant warning reaches the process logger" */
    it("forwards the context and message to the supplied logger unchanged", () => {
      const warn = vi.fn();

      ApiKeyDiagnosticsAdapter.create({ warn }).warn({ keyId: "key_1" }, "grant already revoked");

      expect(warn).toHaveBeenCalledWith({ keyId: "key_1" }, "grant already revoked");
    });
  });
});
