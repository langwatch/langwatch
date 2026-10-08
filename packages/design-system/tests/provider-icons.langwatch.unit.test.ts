/**
 * The Instant Evals model id names LangWatch as its provider, so the icon lookup has to know it.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { describe, expect, it } from "vitest";

import {
  inferProvider,
  isProviderKey,
  MONOCHROME_PROVIDER_ICONS,
  modelProviderIcons,
} from "../src/components/provider-icons.tsx";

const INSTANT_EVALS_MODEL_ID = "langwatch/instant-evals";

describe("provider icon lookup", () => {
  describe("given the Instant Evals model id", () => {
    /** @scenario "The LangWatch mark names a model, never a provider to add" */
    it("names LangWatch as its provider", () => {
      expect(inferProvider(INSTANT_EVALS_MODEL_ID)).toBe("langwatch");
    });

    it("has a mark to draw", () => {
      expect(isProviderKey("langwatch")).toBe(true);
      expect(modelProviderIcons.langwatch).toBeTruthy();
    });

    it("keeps the mark's own colours rather than inverting it on dark", () => {
      expect(MONOCHROME_PROVIDER_ICONS.has("langwatch")).toBe(false);
    });
  });

  describe("given a bare model id with no known prefix", () => {
    it("still names no provider", () => {
      expect(inferProvider("instant-evals")).toBeNull();
    });
  });
});
