import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLangyStore } from "@langwatch/langy-web";
import { syncLangyAfterDefaultModelWrite } from "../codingDefaultSync";

/**
 * The client-side follow-up to any server-side default-model write (a codex
 * connect with defaults, or the settings drawer saving the Default Models
 * config): refresh the default-model caches and keep the composer's model
 * pill on the default it was already following, without ever hijacking an
 * explicit user pick.
 * Specs: specs/model-providers/codex-account-provider.feature,
 *        specs/langy/langy-model-selection.feature
 */

const OLD_DEFAULT = "openai/gpt-5.5";
const CODEX_MODEL = "openai_codex/gpt-5.6-terra";

type Utils = Parameters<typeof syncLangyAfterDefaultModelWrite>[0]["utils"];

function buildUtils({
  previousModel,
  nextModel,
  fetchFails = false,
}: {
  previousModel: string | null;
  nextModel: string | null;
  fetchFails?: boolean;
}) {
  const invalidate = vi.fn().mockResolvedValue(void 0);
  const getData = vi.fn(() => (previousModel ? { model: previousModel } : null));
  const fetch = fetchFails
    ? vi.fn().mockRejectedValue(new Error("resolver unavailable"))
    : vi.fn().mockResolvedValue(nextModel ? { model: nextModel } : null);
  const utils = {
    modelProvider: { invalidate, getResolvedDefault: { getData, fetch } },
  } as unknown as Utils;
  return { utils, invalidate, getData, fetch };
}

describe("syncLangyAfterDefaultModelWrite", () => {
  beforeEach(() => {
    useLangyStore.setState({ modelOverride: "", isModelPickedByUser: false });
  });

  describe("when the pill was following the outgoing default", () => {
    /** @scenario Langy's model pill follows the new coding default immediately */
    it("snaps the pill to what the resolver answers now", async () => {
      useLangyStore.getState().setModelOverride(OLD_DEFAULT);
      const { utils, invalidate } = buildUtils({
        previousModel: OLD_DEFAULT,
        nextModel: CODEX_MODEL,
      });

      await syncLangyAfterDefaultModelWrite({ utils, projectId: "proj-1" });

      expect(useLangyStore.getState().modelOverride).toBe(CODEX_MODEL);
      expect(invalidate).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the pill was never seeded at all", () => {
    it("adopts the new default", async () => {
      const { utils } = buildUtils({
        previousModel: null,
        nextModel: CODEX_MODEL,
      });

      await syncLangyAfterDefaultModelWrite({ utils, projectId: "proj-1" });

      expect(useLangyStore.getState().modelOverride).toBe(CODEX_MODEL);
    });
  });

  describe("when the user explicitly picked a different model", () => {
    /** @scenario A model the user picked on purpose is not hijacked */
    it("leaves the pick alone", async () => {
      useLangyStore.getState().pickModel("anthropic/claude-sonnet-5");
      const { utils } = buildUtils({
        previousModel: OLD_DEFAULT,
        nextModel: CODEX_MODEL,
      });

      await syncLangyAfterDefaultModelWrite({ utils, projectId: "proj-1" });

      expect(useLangyStore.getState().modelOverride).toBe("anthropic/claude-sonnet-5");
    });
  });

  describe("when the allowlist took the picked model away", () => {
    /** @scenario A model the user picked on purpose is not hijacked */
    it("follows the default again, because the pick no longer stands", async () => {
      // The panel snaps the picker to an allowed model when the pick turns out
      // to be outside the allowlist. That snap OVERRULES the user, so the pick
      // is over: were the flag to survive it, the pill would sit on the forced
      // model and refuse every later default for the rest of the conversation.
      useLangyStore.getState().pickModel("anthropic/claude-sonnet-5");
      useLangyStore.getState().setModelOverride(OLD_DEFAULT);
      const { utils } = buildUtils({
        previousModel: OLD_DEFAULT,
        nextModel: CODEX_MODEL,
      });

      await syncLangyAfterDefaultModelWrite({ utils, projectId: "proj-1" });

      expect(useLangyStore.getState().modelOverride).toBe(CODEX_MODEL);
    });
  });

  describe("when the user picked the model that just became the default", () => {
    /** @scenario A pick that matches the default is still the user's pick */
    it("keeps their pick, even when the resolver answers something else", async () => {
      // The "make it the default" flow: the pick and the new default are the
      // same model, so any "is the pill still on the default?" test reads an
      // explicit choice as untouched. A resolver answering the OLD model then
      // pulled the picker back to it, in front of a user who had just chosen.
      useLangyStore.getState().pickModel(CODEX_MODEL);
      const { utils } = buildUtils({
        previousModel: CODEX_MODEL,
        nextModel: OLD_DEFAULT,
      });

      await syncLangyAfterDefaultModelWrite({ utils, projectId: "proj-1" });

      expect(useLangyStore.getState().modelOverride).toBe(CODEX_MODEL);
    });
  });

  describe("when the resolver read fails after the write", () => {
    it("falls back to the model the caller says the write installed", async () => {
      useLangyStore.getState().setModelOverride(OLD_DEFAULT);
      const { utils } = buildUtils({
        previousModel: OLD_DEFAULT,
        nextModel: null,
        fetchFails: true,
      });

      await syncLangyAfterDefaultModelWrite({
        utils,
        projectId: "proj-1",
        fallbackModel: CODEX_MODEL,
      });

      expect(useLangyStore.getState().modelOverride).toBe(CODEX_MODEL);
    });

    it("follows the previous default when no fallback is given, changing nothing", async () => {
      useLangyStore.getState().setModelOverride(OLD_DEFAULT);
      const { utils } = buildUtils({
        previousModel: OLD_DEFAULT,
        nextModel: null,
        fetchFails: true,
      });

      await syncLangyAfterDefaultModelWrite({ utils, projectId: "proj-1" });

      expect(useLangyStore.getState().modelOverride).toBe(OLD_DEFAULT);
    });
  });

  describe("when the settings drawer saves a new default while the panel is open", () => {
    /** @scenario The composer follows a default-model change made in settings */
    it("snaps the picker to the new resolved default without a reload", async () => {
      useLangyStore.getState().setModelOverride(OLD_DEFAULT);
      const { utils } = buildUtils({
        previousModel: OLD_DEFAULT,
        nextModel: "custom/stealth/ox-alpha",
      });

      await syncLangyAfterDefaultModelWrite({ utils, projectId: "proj-1" });

      expect(useLangyStore.getState().modelOverride).toBe("custom/stealth/ox-alpha");
    });
  });

  describe("when the cache invalidation fails after the write", () => {
    it("resolves and still snaps the pill via the written codex model", async () => {
      useLangyStore.getState().setModelOverride(OLD_DEFAULT);
      const { utils, invalidate } = buildUtils({
        previousModel: OLD_DEFAULT,
        nextModel: CODEX_MODEL,
      });
      invalidate.mockRejectedValue(new Error("cache sync unavailable"));

      await expect(
        syncLangyAfterDefaultModelWrite({
          utils,
          projectId: "proj-1",
          fallbackModel: CODEX_MODEL,
        }),
      ).resolves.toBeUndefined();

      expect(useLangyStore.getState().modelOverride).toBe(CODEX_MODEL);
    });
  });

  describe("when the query client cannot answer at all", () => {
    // Callers await this after their write already landed, so a throw here
    // reaches their catch and reports a saved config as a failed one.
    it("resolves rather than rejecting", async () => {
      const utils = { modelProvider: {} } as unknown as Utils;

      await expect(
        syncLangyAfterDefaultModelWrite({ utils, projectId: "proj-1" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the previous default is read", () => {
    it("reads it from the cache BEFORE invalidating, for the langy chat key", async () => {
      const { utils, getData, invalidate } = buildUtils({
        previousModel: OLD_DEFAULT,
        nextModel: CODEX_MODEL,
      });

      await syncLangyAfterDefaultModelWrite({ utils, projectId: "proj-1" });

      expect(getData).toHaveBeenCalledWith({
        projectId: "proj-1",
        featureKey: "langy.chat",
      });
      expect(getData.mock.invocationCallOrder[0]!).toBeLessThan(
        invalidate.mock.invocationCallOrder[0]!,
      );
    });
  });

  describe("when the resolver is re-read after the write", () => {
    it("asks for the same project and langy chat key the cache read used", async () => {
      const { utils, fetch } = buildUtils({
        previousModel: OLD_DEFAULT,
        nextModel: CODEX_MODEL,
      });

      await syncLangyAfterDefaultModelWrite({ utils, projectId: "proj-1" });

      expect(fetch).toHaveBeenCalledWith({
        projectId: "proj-1",
        featureKey: "langy.chat",
      });
    });
  });
});
