import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLangyStore } from "../../stores/langyStore";
import { syncLangyAfterCodingDefaultsWrite } from "../codingDefaultSync";

/**
 * The client-side follow-up to a codex coding-defaults write: refresh the
 * default-model caches and keep the composer's model pill on the default it
 * was already following, without ever hijacking an explicit user pick.
 * Spec: specs/model-providers/codex-account-provider.feature
 */

const OLD_DEFAULT = "openai/gpt-5.5";
const CODEX_MODEL = "openai_codex/gpt-5.6-terra";

type Utils = Parameters<typeof syncLangyAfterCodingDefaultsWrite>[0]["utils"];

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
  const getData = vi.fn(() =>
    previousModel ? { model: previousModel } : null,
  );
  const fetch = fetchFails
    ? vi.fn().mockRejectedValue(new Error("resolver unavailable"))
    : vi.fn().mockResolvedValue(nextModel ? { model: nextModel } : null);
  const utils = {
    modelProvider: { invalidate, getResolvedDefault: { getData, fetch } },
  } as unknown as Utils;
  return { utils, invalidate, getData, fetch };
}

describe("syncLangyAfterCodingDefaultsWrite", () => {
  beforeEach(() => {
    useLangyStore.getState().setModelOverride("");
  });

  describe("when the pill was following the outgoing default", () => {
    /** @scenario Langy's model pill follows the new coding default immediately */
    it("snaps the pill to what the resolver answers now", async () => {
      useLangyStore.getState().setModelOverride(OLD_DEFAULT);
      const { utils, invalidate } = buildUtils({
        previousModel: OLD_DEFAULT,
        nextModel: CODEX_MODEL,
      });

      await syncLangyAfterCodingDefaultsWrite({ utils, projectId: "proj-1" });

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

      await syncLangyAfterCodingDefaultsWrite({ utils, projectId: "proj-1" });

      expect(useLangyStore.getState().modelOverride).toBe(CODEX_MODEL);
    });
  });

  describe("when the user explicitly picked a different model", () => {
    /** @scenario A model the user picked on purpose is not hijacked */
    it("leaves the pick alone", async () => {
      useLangyStore.getState().setModelOverride("anthropic/claude-sonnet-5");
      const { utils } = buildUtils({
        previousModel: OLD_DEFAULT,
        nextModel: CODEX_MODEL,
      });

      await syncLangyAfterCodingDefaultsWrite({ utils, projectId: "proj-1" });

      expect(useLangyStore.getState().modelOverride).toBe(
        "anthropic/claude-sonnet-5",
      );
    });
  });

  describe("when the resolver read fails after the write", () => {
    it("falls back to the codex model the write just installed", async () => {
      useLangyStore.getState().setModelOverride(OLD_DEFAULT);
      const { utils } = buildUtils({
        previousModel: OLD_DEFAULT,
        nextModel: null,
        fetchFails: true,
      });

      await syncLangyAfterCodingDefaultsWrite({ utils, projectId: "proj-1" });

      expect(useLangyStore.getState().modelOverride).toBe(CODEX_MODEL);
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
        syncLangyAfterCodingDefaultsWrite({ utils, projectId: "proj-1" }),
      ).resolves.toBeUndefined();

      expect(useLangyStore.getState().modelOverride).toBe(CODEX_MODEL);
    });
  });

  describe("when the previous default is read", () => {
    it("reads it from the cache BEFORE invalidating, for the langy chat key", async () => {
      const { utils, getData, invalidate } = buildUtils({
        previousModel: OLD_DEFAULT,
        nextModel: CODEX_MODEL,
      });

      await syncLangyAfterCodingDefaultsWrite({ utils, projectId: "proj-1" });

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

      await syncLangyAfterCodingDefaultsWrite({ utils, projectId: "proj-1" });

      expect(fetch).toHaveBeenCalledWith({
        projectId: "proj-1",
        featureKey: "langy.chat",
      });
    });
  });
});
