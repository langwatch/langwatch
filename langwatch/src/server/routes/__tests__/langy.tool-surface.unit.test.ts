import { describe, expect, it } from "vitest";
import { buildLangyTools } from "~/server/services/langy/tools";
import { ConversationToolIdSet } from "~/server/services/langy/toolIdValidator";

const ALLOWED_PREFIXES = ["list_", "get_", "find_", "search_", "propose_"];

/**
 * Stub context — `buildLangyTools` reads from `ctx` lazily during
 * tool `execute`, so we never touch the stub during this surface test.
 * Tool names are determined statically by the barrel.
 */
const stubCtx = {
  projectId: "proj-test",
  experimentSlug: undefined,
  batchEvaluationService: {} as never,
  datasetService: {} as never,
  evaluatorService: {} as never,
  experimentService: {} as never,
  projectService: {} as never,
  promptService: {} as never,
  seenIds: new ConversationToolIdSet(),
};

const toolNames = Object.keys(buildLangyTools(stubCtx));

describe("Langy v1 tool surface contract — binds langy-baseline.feature § read-only boundary", () => {
  describe("given the registered tools assembled by buildLangyTools", () => {
    it("registers at least one tool (the barrel is wired up)", () => {
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
