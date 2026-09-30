/**
 * @see specs/home/guided-onboarding-offer.feature
 */
import { describe, expect, it } from "vitest";

import { offeredPath } from "../offered-path.ts";

const state = (over: Partial<Parameters<typeof offeredPath>[0]["state"]> = {}) => ({
  variant: "guided" as const,
  currentPath: null,
  donePaths: [],
  ...over,
});

describe("offeredPath", () => {
  describe("given an organization in the guided variant", () => {
    it("offers each space its own path", () => {
      expect(offeredPath({ space: "project", state: state() })).toBe("llmops");
      expect(offeredPath({ space: "gateway", state: state() })).toBe("gateway");
      expect(offeredPath({ space: "governance", state: state() })).toBe("governance");
      expect(offeredPath({ space: "me", state: state() })).toBe("coding");
    });

    it("offers nothing while Langy is guiding that space", () => {
      expect(
        offeredPath({ space: "gateway", state: state({ currentPath: "gateway" }) }),
      ).toBeNull();
    });

    it("offers nothing once that path is done", () => {
      expect(
        offeredPath({ space: "gateway", state: state({ donePaths: ["gateway"] }) }),
      ).toBeNull();
    });
  });

  describe("given an organization outside the guided variant", () => {
    it("offers nothing", () => {
      expect(offeredPath({ space: "project", state: state({ variant: "classic" }) })).toBeNull();
      expect(offeredPath({ space: "project", state: state({ variant: null }) })).toBeNull();
    });
  });
});
