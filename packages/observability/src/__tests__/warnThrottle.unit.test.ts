/** Spec: specs/observability/slow-work-warnings.feature */
import { describe, expect, it } from "vitest";

import { createWarnThrottle } from "../warn-throttle.ts";

describe("createWarnThrottle", () => {
  describe("given a throttle that remembers at most two identities", () => {
    /** @scenario A throttle remembers a bounded number of identities */
    it("forgets the identity that warned longest ago and keeps the others quiet", () => {
      const throttle = createWarnThrottle(60_000, { maxKeys: 2 });

      expect(throttle.claim({ key: "a", now: 0 })).toBe(0);
      expect(throttle.claim({ key: "b", now: 1 })).toBe(0);
      expect(throttle.claim({ key: "c", now: 2 })).toBe(0);

      expect(throttle.claim({ key: "c", now: 3 })).toBeUndefined();
      expect(throttle.claim({ key: "b", now: 4 })).toBeUndefined();
      expect(throttle.claim({ key: "a", now: 5 })).toBe(0);
    });
  });
});
