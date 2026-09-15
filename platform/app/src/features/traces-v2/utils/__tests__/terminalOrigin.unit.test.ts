import { describe, expect, it } from "vitest";
import { isTerminalOrigin } from "../terminalOrigin";

describe("isTerminalOrigin", () => {
  describe("given a Claude Code service name", () => {
    it("is true for the hyphenated form", () => {
      expect(isTerminalOrigin({ serviceName: "claude-code" })).toBe(true);
    });

    it("is true for the underscored form", () => {
      expect(isTerminalOrigin({ serviceName: "Claude_Code" })).toBe(true);
    });
  });

  describe("given pi's service name", () => {
    it("is true for the exact name", () => {
      expect(isTerminalOrigin({ serviceName: "pi" })).toBe(true);
    });

    it("is true regardless of case", () => {
      expect(isTerminalOrigin({ serviceName: "PI" })).toBe(true);
    });

    // Two letters are not a marker: matched as a substring, "pi" would claim
    // every service with those letters anywhere in its name.
    it.each([
      "pipeline-worker",
      "spider",
      "my-api",
      "shipping-worker",
    ])("is false for %s, which only contains the letters", (serviceName) => {
      expect(isTerminalOrigin({ serviceName })).toBe(false);
    });
  });

  describe("given a coding-agent origin", () => {
    it("is true", () => {
      expect(isTerminalOrigin({ origin: "coding_agent" })).toBe(true);
    });
  });

  describe("given a terminal.type attribute", () => {
    it("is true when a terminal type is reported", () => {
      expect(isTerminalOrigin({ terminalType: "xterm-256color" })).toBe(true);
    });

    it("is false for an empty terminal type", () => {
      expect(isTerminalOrigin({ terminalType: "  " })).toBe(false);
    });
  });

  describe("given none of the terminal signals", () => {
    it("is false for a plain application trace", () => {
      expect(
        isTerminalOrigin({ serviceName: "my-api", origin: "application" }),
      ).toBe(false);
    });

    it("is false for empty signals", () => {
      expect(isTerminalOrigin({})).toBe(false);
    });
  });
});
