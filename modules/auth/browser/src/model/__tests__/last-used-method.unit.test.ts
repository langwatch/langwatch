// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  promotePendingMethod,
  readLastUsedMethodId,
  rememberPendingMethod,
} from "../last-used-method.ts";

describe("given a social provider dialled from the door", () => {
  beforeEach(() => window.localStorage.clear());

  describe("when the browser comes back without a session", () => {
    /** @scenario A social provider I backed out of is never badged */
    it("badges nothing, because only a session promotes the parked method", () => {
      rememberPendingMethod({ id: "google" });

      expect(readLastUsedMethodId()).toBeNull();
    });
  });

  describe("when the browser comes back holding a session", () => {
    it("badges the provider that got the person in", () => {
      rememberPendingMethod({ id: "google" });

      promotePendingMethod();

      expect(readLastUsedMethodId()).toBe("google");
    });
  });
});
