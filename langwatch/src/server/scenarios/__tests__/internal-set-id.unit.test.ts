/**
 * @vitest-environment node
 *
 * Unit tests for internal set ID utilities.
 *
 * These utilities enable distinguishing between:
 * - Internal sets: Created by the LangWatch platform (namespaced to avoid collisions)
 * - User sets: Created by users via SDK or UI
 *
 * @see specs/scenarios/internal-set-namespace.feature
 */

import { describe, expect, it } from "vitest";
import {
  isInternalSetId,
  isOnPlatformSet,
  getOnPlatformSetId,
  INTERNAL_SET_PREFIX,
  ON_PLATFORM_SET_SUFFIX,
} from "../internal-set-id";

describe("internal-set-id utilities", () => {
  describe("isInternalSetId()", () => {
    describe("given a set ID with __internal__ prefix", () => {
      describe("when isInternalSetId is called", () => {
        it("returns true", () => {
          const setId = "__internal__proj_abc123__on-platform-scenarios";
          expect(isInternalSetId(setId)).toBe(true);
        });
      });
    });

    describe("given a user-created set ID", () => {
      describe("when isInternalSetId is called", () => {
        it("returns false for custom set names", () => {
          expect(isInternalSetId("my-custom-scenarios")).toBe(false);
        });

        it("returns false for production-tests", () => {
          expect(isInternalSetId("production-tests")).toBe(false);
        });

        it("returns false for sets containing internal but not as prefix", () => {
          expect(isInternalSetId("my__internal__set")).toBe(false);
        });
      });
    });

    describe("given edge cases", () => {
      it("returns false for empty string", () => {
        expect(isInternalSetId("")).toBe(false);
      });

      it("returns true for prefix only", () => {
        expect(isInternalSetId(INTERNAL_SET_PREFIX)).toBe(true);
      });
    });
  });

  describe("isOnPlatformSet()", () => {
    describe("given a set ID with __on-platform-scenarios suffix", () => {
      describe("when isOnPlatformSet is called", () => {
        it("returns true", () => {
          const setId = "__internal__proj_abc123__on-platform-scenarios";
          expect(isOnPlatformSet(setId)).toBe(true);
        });
      });
    });

    describe("given an internal set without on-platform suffix", () => {
      describe("when isOnPlatformSet is called", () => {
        it("returns false", () => {
          const setId = "__internal__proj_abc123__custom-scenarios";
          expect(isOnPlatformSet(setId)).toBe(false);
        });
      });
    });

    describe("given a user-created set ID", () => {
      describe("when isOnPlatformSet is called", () => {
        it("returns false for custom set names", () => {
          expect(isOnPlatformSet("my-custom-scenarios")).toBe(false);
        });

        it("returns false for sets containing suffix in the middle", () => {
          expect(isOnPlatformSet("__on-platform-scenarios-backup")).toBe(false);
        });
      });
    });

    describe("given edge cases", () => {
      it("returns false for empty string", () => {
        expect(isOnPlatformSet("")).toBe(false);
      });

      it("returns true for suffix only", () => {
        expect(isOnPlatformSet(ON_PLATFORM_SET_SUFFIX)).toBe(true);
      });
    });
  });

  describe("getOnPlatformSetId()", () => {
    describe("given a project ID", () => {
      describe("when getOnPlatformSetId is called", () => {
        it("generates correct internal set ID format", () => {
          const projectId = "proj_abc123";
          const result = getOnPlatformSetId(projectId);
          expect(result).toBe("__internal__proj_abc123__on-platform-scenarios");
        });

        it("generates ID that passes isInternalSetId check", () => {
          const result = getOnPlatformSetId("proj_xyz");
          expect(isInternalSetId(result)).toBe(true);
        });

        it("generates ID that passes isOnPlatformSet check", () => {
          const result = getOnPlatformSetId("proj_xyz");
          expect(isOnPlatformSet(result)).toBe(true);
        });
      });
    });

    describe("given different project IDs", () => {
      it("generates unique set IDs per project", () => {
        const id1 = getOnPlatformSetId("proj_1");
        const id2 = getOnPlatformSetId("proj_2");
        expect(id1).not.toBe(id2);
      });

      it("includes project ID in the generated set ID", () => {
        const projectId = "proj_special_123";
        const result = getOnPlatformSetId(projectId);
        expect(result).toContain(projectId);
      });
    });
  });

  describe("constants", () => {
    it("INTERNAL_SET_PREFIX is __internal__", () => {
      expect(INTERNAL_SET_PREFIX).toBe("__internal__");
    });

    it("ON_PLATFORM_SET_SUFFIX is __on-platform-scenarios", () => {
      expect(ON_PLATFORM_SET_SUFFIX).toBe("__on-platform-scenarios");
    });
  });
});
