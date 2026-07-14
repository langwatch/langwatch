import { describe, expect, it } from "vitest";

import {
  PLATFORM_TOOL_POLICIES,
  resolvePlatformToolPolicy,
} from "@/cli/utils/governance/platform-tool-policy";

describe("PLATFORM_TOOL_POLICIES", () => {
  describe("Stage A defaults", () => {
    it("allows both paths for the four terminal-based tools", () => {
      for (const slug of ["claude", "codex", "gemini", "opencode"] as const) {
        expect(PLATFORM_TOOL_POLICIES[slug]).toEqual({
          allowVk: true,
          allowOtelDirect: true,
        });
      }
    });

    it("disables Path B for cursor (GUI app, no terminal env reaches the agent panel)", () => {
      expect(PLATFORM_TOOL_POLICIES.cursor).toEqual({
        allowVk: true,
        allowOtelDirect: false,
      });
    });
  });
});

describe("resolvePlatformToolPolicy", () => {
  describe("when the tool is in the platform catalog", () => {
    it("returns the catalog row by slug", () => {
      expect(resolvePlatformToolPolicy("claude")).toEqual({
        allowVk: true,
        allowOtelDirect: true,
      });
      expect(resolvePlatformToolPolicy("cursor")).toEqual({
        allowVk: true,
        allowOtelDirect: false,
      });
    });
  });

  describe("when the tool is unknown", () => {
    it("returns the conservative defaults so a typo doesn't crash the wrapper", () => {
      expect(resolvePlatformToolPolicy("unknown-tool")).toEqual({
        allowVk: true,
        allowOtelDirect: true,
      });
    });
  });

  describe("when a login-cached policy map is present", () => {
    it("prefers the cached entry over the hardcoded default", () => {
      const cached = {
        claude: { allowVk: true, allowOtelDirect: false },
      };
      expect(resolvePlatformToolPolicy("claude", cached)).toEqual({
        allowVk: true,
        allowOtelDirect: false,
      });
    });

    it("can disable the gateway path for a tool the org forced onto OTLP", () => {
      const cached = {
        claude: { allowVk: false, allowOtelDirect: true },
      };
      expect(resolvePlatformToolPolicy("claude", cached)).toEqual({
        allowVk: false,
        allowOtelDirect: true,
      });
    });

    it("falls back to the hardcoded default for a tool the cache omits", () => {
      const cached = {
        claude: { allowVk: false, allowOtelDirect: false },
      };
      // cursor not in the cache -> hardcoded default (OTLP off).
      expect(resolvePlatformToolPolicy("cursor", cached)).toEqual({
        allowVk: true,
        allowOtelDirect: false,
      });
    });

    it("falls back to defaults when the cache is empty (offline / legacy CLI)", () => {
      expect(resolvePlatformToolPolicy("claude", {})).toEqual({
        allowVk: true,
        allowOtelDirect: true,
      });
      expect(resolvePlatformToolPolicy("claude", undefined)).toEqual({
        allowVk: true,
        allowOtelDirect: true,
      });
    });
  });
});
