import { describe, expect, it } from "vitest";
import { withoutHiddenResourceAttrs } from "../tracesV2.resourceAttrs";

describe("withoutHiddenResourceAttrs", () => {
  describe("given resource attributes carrying the internal non-billable marker", () => {
    /** @scenario "The internal non-billable cost marker is hidden from the trace resources view" */
    it("strips the non-billable cost marker while keeping real metadata", () => {
      const filtered = withoutHiddenResourceAttrs({
        "service.name": "codex_cli_rs",
        "langwatch.cost.non_billable": "true",
        "telemetry.sdk.language": "rust",
      });

      expect(filtered["langwatch.cost.non_billable"]).toBeUndefined();
      expect(filtered["service.name"]).toBe("codex_cli_rs");
      expect(filtered["telemetry.sdk.language"]).toBe("rust");
    });
  });

  describe("given resource attributes without any hidden marker", () => {
    it("returns the same object reference unchanged", () => {
      const input = { "service.name": "opencode" };
      expect(withoutHiddenResourceAttrs(input)).toBe(input);
    });
  });
});
