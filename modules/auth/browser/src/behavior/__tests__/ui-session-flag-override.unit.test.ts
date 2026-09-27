/**
 * @vitest-environment jsdom
 * A flag this browser set with `?ff_` is the session's answer, and the server is
 * never asked for it.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import {
  applyFeatureFlagOverridesFromSearch,
  clearAllFeatureFlagOverrides,
} from "@langwatch/browser-host/feature-flag-overrides";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserUiSession } from "../ui-session.ts";

const FLAG = "experiment_onboarding_langy_guided";

function sessionWith({ flags = new Map<string, boolean>() } = {}) {
  const askFlag = vi.fn();
  const session = BrowserUiSession.create({
    flags,
    askFlag,
    actor: null,
    permissions: undefined,
    settled: true,
  });
  return { session, askFlag };
}

describe("given the page was opened with ?ff_experiment_onboarding_langy_guided=on", () => {
  beforeEach(() => {
    clearAllFeatureFlagOverrides();
    applyFeatureFlagOverridesFromSearch(`?ff_${FLAG}=on`);
  });

  describe("when the frontend reads the flag", () => {
    /** @scenario "the browser query override turns the guided variant on in that browser" */
    it("resolves to true without asking the server", () => {
      const { session, askFlag } = sessionWith();

      expect(session.featureFlag(FLAG)).toBe(true);
      expect(askFlag).not.toHaveBeenCalled();
    });

    it("wins over what the server answered", () => {
      const { session } = sessionWith({ flags: new Map([[FLAG, false]]) });

      expect(session.featureFlag(FLAG)).toBe(true);
    });
  });
});

describe("given no override", () => {
  beforeEach(() => clearAllFeatureFlagOverrides());

  describe("when the frontend reads a flag the server has not answered", () => {
    it("asks the server for it", () => {
      const { session, askFlag } = sessionWith();

      expect(session.featureFlag(FLAG)).toBeUndefined();
      expect(askFlag).toHaveBeenCalledWith(FLAG);
    });
  });
});
