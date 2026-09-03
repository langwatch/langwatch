/**
 * The override resolver holds the last registry text it read for the life of
 * the PROCESS (not per-conversation), deliberately: a Prisma blip on a later
 * turn must not swap the system block, which is the provider's cache prefix.
 */
import { describe, expect, it, vi } from "vitest";
import { LANGY_TURN_OVERRIDE_FALLBACK } from "@langwatch/langy-contract";
import { LangyTurnOverrideService } from "../langy-turn-override.service";
import type { LangyPromptPort } from "../langy-prompt-registry.service";

function fakePrompts(
  tryGetPromptByIdOrHandle: LangyPromptPort["tryGetPromptByIdOrHandle"],
): LangyPromptPort {
  return { tryGetPromptByIdOrHandle };
}

describe("LangyTurnOverrideService", () => {
  describe("given no prompt project is configured", () => {
    /** @scenario "A turn runs from the in-repo copy when no registry row exists" */
    it("never consults the registry", async () => {
      const tryGetPromptByIdOrHandle = vi.fn();
      const service = LangyTurnOverrideService.create({
        prompts: fakePrompts(tryGetPromptByIdOrHandle),
        projectId: undefined,
      });

      const result = await service.resolve();

      expect(tryGetPromptByIdOrHandle).not.toHaveBeenCalled();
      expect(result).toEqual({
        text: LANGY_TURN_OVERRIDE_FALLBACK,
        source: "unconfigured",
      });
    });
  });

  describe("given a project holding Langy's versioned prompts", () => {
    // @scenario "A read failure after a successful read keeps the text already in use"
    it("reuses the last text it read when a later read fails, not the constant", async () => {
      let readCount = 0;
      const tryGetPromptByIdOrHandle = vi.fn(async () => {
        readCount += 1;
        if (readCount === 1) return { prompt: "REGISTRY OVERRIDE TEXT" };
        throw new Error("registry down");
      });

      const first = LangyTurnOverrideService.create({
        prompts: fakePrompts(tryGetPromptByIdOrHandle),
        projectId: "project-system",
      });
      expect(await first.resolve()).toEqual({
        text: "REGISTRY OVERRIDE TEXT",
        source: "registry",
      });

      const second = LangyTurnOverrideService.create({
        prompts: fakePrompts(tryGetPromptByIdOrHandle),
        projectId: "project-system",
      });
      const result = await second.resolve();

      expect(result).toEqual({
        text: "REGISTRY OVERRIDE TEXT",
        source: "cached",
      });
      expect(result.text).not.toBe(LANGY_TURN_OVERRIDE_FALLBACK);
    });

    // @scenario "Withdrawing a promoted version is not undone by a later read failure"
    it("does not resurrect a demoted row when a later read fails", async () => {
      // Read 1 hits a promoted row; read 2 is a GENUINE miss (the operator
      // demoted or deleted it); read 3 is a transient failure. The blip must
      // fall back to the in-repo constant — the text from read 1 is gone on
      // purpose, and a cache that outlives the miss would serve it back on
      // every failure for the rest of the process's life.
      let readCount = 0;
      const tryGetPromptByIdOrHandle = vi.fn(async () => {
        readCount += 1;
        if (readCount === 1) return { prompt: "REGISTRY OVERRIDE TEXT" };
        if (readCount === 2) return null;
        throw new Error("registry down");
      });
      const resolveOnce = () =>
        LangyTurnOverrideService.create({
          prompts: fakePrompts(tryGetPromptByIdOrHandle),
          projectId: "project-system",
        }).resolve();

      expect((await resolveOnce()).text).toBe("REGISTRY OVERRIDE TEXT");
      // The turn that observes the miss already fell through correctly; it is
      // the one AFTER it that regressed.
      expect((await resolveOnce()).text).toBe(LANGY_TURN_OVERRIDE_FALLBACK);

      const afterBlip = await resolveOnce();

      expect(afterBlip.text).not.toBe("REGISTRY OVERRIDE TEXT");
      expect(afterBlip.text).toBe(LANGY_TURN_OVERRIDE_FALLBACK);
    });
  });
});
