import { describe, expect, it } from "vitest";
import {
  type ProcessRole,
  roleRunsWorkers,
  roleSatisfiesRunIn,
} from "../config";

describe("roleRunsWorkers", () => {
  describe("given a role that hosts the worker stack", () => {
    it("returns true for the dedicated worker role", () => {
      expect(roleRunsWorkers("worker")).toBe(true);
    });

    it("returns true for the in-process 'all' role (dev single-process mode)", () => {
      expect(roleRunsWorkers("all")).toBe(true);
    });
  });

  describe("given a role that does not host the worker stack", () => {
    it("returns false for the web role", () => {
      expect(roleRunsWorkers("web")).toBe(false);
    });

    it("returns false for the migration role", () => {
      expect(roleRunsWorkers("migration")).toBe(false);
    });

    it("returns false when the role is undefined (dispatch-only)", () => {
      expect(roleRunsWorkers(undefined)).toBe(false);
    });
  });

  describe("given every ProcessRole variant", () => {
    /** @scenario roleRunsWorkers treats worker and all as worker-hosting roles */
    it("treats exactly worker and all as worker-hosting roles", () => {
      const roles: ProcessRole[] = ["web", "worker", "migration", "all"];
      const hosting = roles.filter(roleRunsWorkers);
      expect(hosting).toEqual(["worker", "all"]);
    });
  });
});

describe("roleSatisfiesRunIn", () => {
  describe("given a reactor with no runIn filter", () => {
    it("runs under any role (undefined filter means run everywhere)", () => {
      expect(roleSatisfiesRunIn(undefined, "web")).toBe(true);
      expect(roleSatisfiesRunIn(undefined, "worker")).toBe(true);
      expect(roleSatisfiesRunIn(undefined, "all")).toBe(true);
    });
  });

  describe("given the process role is undefined", () => {
    it("does not exclude the reactor (backwards-compatible run-everywhere)", () => {
      expect(roleSatisfiesRunIn(["worker"], undefined)).toBe(true);
    });
  });

  describe("given the in-process 'all' role", () => {
    // The regression the P0 fix guards: a worker-only reactor MUST run under
    // "all", otherwise `pnpm dev:single` boots the worker stack but every
    // runIn-gated reactor is silently skipped.
    it("satisfies a worker-only runIn filter", () => {
      expect(roleSatisfiesRunIn(["worker"], "all")).toBe(true);
    });

    it("satisfies a web+worker runIn filter", () => {
      expect(roleSatisfiesRunIn(["web", "worker"], "all")).toBe(true);
    });

    it("satisfies even a web-only runIn filter (all plays every role)", () => {
      expect(roleSatisfiesRunIn(["web"], "all")).toBe(true);
    });
  });

  describe("given a dedicated role and a matching filter", () => {
    it("runs a worker reactor under the worker role", () => {
      expect(roleSatisfiesRunIn(["worker"], "worker")).toBe(true);
    });

    it("runs a web+worker reactor under the web role", () => {
      expect(roleSatisfiesRunIn(["web", "worker"], "web")).toBe(true);
    });
  });

  describe("given a dedicated role and a non-matching filter", () => {
    it("excludes a worker-only reactor under the web role", () => {
      expect(roleSatisfiesRunIn(["worker"], "web")).toBe(false);
    });

    it("excludes a web-only reactor under the worker role", () => {
      expect(roleSatisfiesRunIn(["web"], "worker")).toBe(false);
    });

    it("excludes a worker-only reactor under the migration role", () => {
      expect(roleSatisfiesRunIn(["worker"], "migration")).toBe(false);
    });
  });
});
