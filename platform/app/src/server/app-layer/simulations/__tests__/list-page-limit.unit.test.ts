/**
 * @vitest-environment node
 *
 * @see specs/scenarios/simulation-runs-api.feature
 */
import { describe, expect, it } from "vitest";

import {
  clampPageLimit,
  FULL_MESSAGES_PAGE_LIMIT,
  LIST_PAGE_LIMIT,
} from "../repositories/simulation.clickhouse.repository";

describe("clampPageLimit()", () => {
  describe("when the caller reads the trimmed projection", () => {
    it("allows up to the list ceiling", () => {
      expect(clampPageLimit({ limit: 100, includeMessages: false })).toBe(
        LIST_PAGE_LIMIT,
      );
      expect(clampPageLimit({ limit: 20, includeMessages: false })).toBe(20);
    });
  });

  describe("when the caller asks for whole conversations", () => {
    /** @scenario "include=messages caps the page size" */
    it("reduces the page to the full-message cap", () => {
      expect(clampPageLimit({ limit: 100, includeMessages: true })).toBe(
        FULL_MESSAGES_PAGE_LIMIT,
      );
    });

    it("leaves a page already under the cap alone", () => {
      expect(clampPageLimit({ limit: 5, includeMessages: true })).toBe(5);
    });
  });

  describe("when the limit is below one", () => {
    it("floors at a single run", () => {
      expect(clampPageLimit({ limit: 0, includeMessages: false })).toBe(1);
      expect(clampPageLimit({ limit: -3, includeMessages: true })).toBe(1);
    });
  });
});
