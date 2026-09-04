/**
 * The canonical-generation guard for every LangWatch request the tools make.
 *
 * specs/mcp-server/canonical-v1-request-paths.feature
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initConfig } from "../config.js";
import { listDashboards } from "../langwatch-api-dashboards.js";

const SERVER_SRC = resolve(__dirname, "..");

/**
 * The families the served surface answers for at `/api/v1` as well as bare
 * (packages/api/adrs/002 section 1). Everything else keeps its bare address.
 */
const V1_FAMILIES = new Set(
  `agent-cache analytics annotations api-keys bug-reports coding-agent dashboards dataset dspy
   evaluations evaluators events experiment experiments governance graphs groups guardrails langy me
   model-defaults model-providers monitors optimization organization organizations playground
   prompts role-bindings roles scenario-events scenarios scim-tokens simulation-runs suites
   teams trace traces trigger triggers workflows`.split(/\s+/),
);

const BARE_PATH = /\/api\\?\/([a-zA-Z0-9_-]+)((?:\\?\/[a-zA-Z0-9_-]+)*)/g;
const VERSION_SEGMENT = /^v\d+$/;

/** Routes the document keeps bare because they have no `/api/v1` twin. */
const BARE_ONLY = [/^\/api\/traces\/[^/]+\/transcript$/];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return entry === "node_modules" ? [] : sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".d.ts") ? [path] : [];
  });
}

describe("given the request paths the MCP server builds", () => {
  describe("when the LangWatch API modules are read", () => {
    /** @scenario "Tool request paths are v1-form" */
    it("addresses no REST family at its bare /api address", () => {
      // The guard's own file names bare paths as data; scanning it would
      // make it flag itself.
      const files = sourceFiles(SERVER_SRC).filter((file) => file !== __filename);
      // A guard that reads no files would pass while proving nothing.
      expect(files.length).toBeGreaterThan(40);

      const offenders: string[] = [];
      for (const file of files) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(BARE_PATH)) {
          if (!V1_FAMILIES.has(match[1]!)) continue;
          const segments = (match[2] ?? "").split(/\\?\//).filter(Boolean);
          if (segments.some((segment) => VERSION_SEGMENT.test(segment))) continue;
          if (BARE_ONLY.some((bare) => bare.test(match[0]!.replace(/\\/g, "")))) continue;
          if (BARE_ONLY.some((bare) => bare.test(match[0]!))) continue;
          const line = source.slice(0, match.index).split("\n").length;
          offenders.push(`${file.slice(SERVER_SRC.length + 1)}:${line} ${match[0]}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe("when the dashboards tool lists dashboards", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      initConfig({ apiKey: "test-key", endpoint: "https://app.example.com" });
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    /** @scenario "A dashboard list goes out at the canonical address" */
    it("requests the canonical /api/v1/dashboards address", async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ dashboards: [] }), { status: 200 }));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await listDashboards();

      expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://app.example.com/api/v1/dashboards");
    });
  });
});
