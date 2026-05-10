import { describe, it, expect } from "vitest";
import { parseClientSource } from "../parseClientSource";

describe("parseClientSource", () => {
  describe("when User-Agent matches the langwatch pattern", () => {
    it("extracts mcp source and version", () => {
      expect(parseClientSource("langwatch-mcp/0.42.1")).toEqual({
        source: "mcp",
        version: "0.42.1",
      });
    });

    it("extracts cli source and version", () => {
      expect(parseClientSource("langwatch-cli/1.0.0")).toEqual({
        source: "cli",
        version: "1.0.0",
      });
    });

    it("extracts skill source", () => {
      expect(parseClientSource("langwatch-skill/datasets@0.3.0")).toEqual({
        source: "skill",
        version: "datasets@0.3.0",
      });
    });

    it("matches case-insensitively but normalizes the source label to lowercase", () => {
      expect(parseClientSource("LangWatch-MCP/0.42.1")).toEqual({
        source: "mcp",
        version: "0.42.1",
      });
    });

    it("preserves complex semver strings", () => {
      expect(parseClientSource("langwatch-sdk-ts/2.0.0-beta.1+build.7")).toEqual({
        source: "sdk-ts",
        version: "2.0.0-beta.1+build.7",
      });
    });
  });

  describe("when User-Agent is missing or unrecognized", () => {
    it("returns unknown for null", () => {
      expect(parseClientSource(null)).toEqual({ source: "unknown" });
    });

    it("returns unknown for undefined", () => {
      expect(parseClientSource(undefined)).toEqual({ source: "unknown" });
    });

    it("returns unknown for empty string", () => {
      expect(parseClientSource("")).toEqual({ source: "unknown" });
    });

    it("returns unknown for browser user agents", () => {
      expect(
        parseClientSource(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
        ),
      ).toEqual({ source: "unknown" });
    });

    it("returns unknown for unknown langwatch product names", () => {
      expect(parseClientSource("langwatch-future/1.0")).toEqual({
        source: "unknown",
      });
    });

    it("returns unknown for malformed langwatch UA without a version", () => {
      expect(parseClientSource("langwatch-mcp/")).toEqual({ source: "unknown" });
    });
  });
});
