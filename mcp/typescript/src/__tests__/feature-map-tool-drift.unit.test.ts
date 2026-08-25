/**
 * Drift guard between the MCP tools this server registers and the names
 * `feature-map.json` tells agents to call.
 *
 * The feature map is the canonical information architecture: it is embedded
 * into the CLI at codegen time and shipped inside the npx server package, so a
 * name in it is a name an agent will try. Two entries pointed at
 * `platform_run_evaluation` and `platform_evaluation_status`, which have never
 * existed — the tools are `platform_run_experiment` and
 * `platform_experiment_status`. An agent following the map for the experiments
 * feature called two tools that were not there.
 *
 * Nothing compared the two lists, which is why it went unnoticed. This does.
 *
 * @see .claude/skills/feature-map/SKILL.md
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "../../../..");

/**
 * Every tool name the feature map hands to an agent, from any depth: `mcp`
 * arrays hang off surfaces nested several levels into the tree.
 */
function toolNamesInFeatureMap(): Set<string> {
  const map: unknown = JSON.parse(
    readFileSync(join(REPO_ROOT, "feature-map.json"), "utf-8"),
  );
  const names = new Set<string>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node === null || typeof node !== "object") return;

    const entry = node as Record<string, unknown>;
    if (Array.isArray(entry.mcp)) {
      for (const name of entry.mcp) {
        if (typeof name === "string") names.add(name);
      }
    }
    for (const value of Object.values(entry)) walk(value);
  };

  walk(map);
  return names;
}

/**
 * Every name passed as the first argument of a `server.tool(` registration.
 *
 * Read from the source rather than by constructing a server: building one
 * needs config and credentials this test has no business holding, and the
 * registration is a string literal in every case.
 */
function registeredToolNames(): Set<string> {
  const source = readFileSync(join(__dirname, "../create-mcp-server.ts"), "utf-8");
  const names = new Set<string>();
  for (const match of source.matchAll(/server\.tool\(\s*"([^"]+)"/g)) {
    names.add(match[1]!);
  }
  return names;
}

describe("feature map MCP tool names", () => {
  describe("given the tools this server registers", () => {
    it("names only tools that exist", () => {
      const registered = registeredToolNames();
      const missing = [...toolNamesInFeatureMap()]
        .filter((name) => !registered.has(name))
        .sort();

      // Listed, not registered: an agent following the map calls a tool that
      // is not there. Either rename the entry, or register the tool.
      expect(missing).toEqual([]);
    });

    it("finds the registrations it is reading", () => {
      // A regex that silently matched nothing would make the check above pass
      // for the wrong reason.
      const registered = registeredToolNames();
      expect(registered.size).toBeGreaterThan(50);
      expect(registered).toContain("platform_run_experiment");
    });
  });
});
