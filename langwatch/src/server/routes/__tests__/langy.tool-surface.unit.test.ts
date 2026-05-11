import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE_FILE = join(__dirname, "..", "langy.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_FILE, "utf8");

const TOOL_REGISTRATION_REGEX = /\n\s{4}([a-z_][a-z0-9_]*):\s*tool\(/g;
const ALLOWED_PREFIXES = ["list_", "get_", "find_", "search_", "propose_"];

function extractRegisteredToolNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(TOOL_REGISTRATION_REGEX)) {
    const name = match[1];
    if (name) names.push(name);
  }
  return names;
}

describe("Langy v1 tool surface contract — binds langy-baseline.feature § read-only boundary", () => {
  describe("given the registered tools in src/server/routes/langy.ts", () => {
    const toolNames = extractRegisteredToolNames(ROUTE_SOURCE);

    it("registers at least one tool (route file is wired up)", () => {
      expect(toolNames.length).toBeGreaterThan(0);
    });

    describe("when inspecting each tool name", () => {
      it.each(toolNames.map((name) => [name]))(
        "starts %s with a read-only or propose_ prefix",
        (name) => {
          const isAllowed = ALLOWED_PREFIXES.some((p) => name.startsWith(p));
          expect(
            isAllowed,
            `Tool "${name}" violates the v1 read-only boundary. ` +
              `Langy v1 must only expose tools prefixed with one of: ${ALLOWED_PREFIXES.join(", ")}. ` +
              `Mutations must go through a propose_* tool that returns a proposal payload for user approval.`,
          ).toBe(true);
        },
      );
    });

    describe("when looking for the propose-only safety boundary", () => {
      it("exposes at least one propose_* tool (otherwise Langy cannot suggest changes)", () => {
        const proposeTools = toolNames.filter((n) => n.startsWith("propose_"));
        expect(proposeTools.length).toBeGreaterThan(0);
      });

      it("exposes at least one list_* tool (otherwise Langy cannot ground its answers)", () => {
        const listTools = toolNames.filter((n) => n.startsWith("list_"));
        expect(listTools.length).toBeGreaterThan(0);
      });
    });
  });
});
