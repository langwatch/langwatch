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
    /** @scenario "Each process installs only its AuthZ responsibilities" */
    /** @scenario roleRunsWorkers treats worker and all as worker-hosting roles */
    it("treats exactly worker and all as worker-hosting roles", () => {
      const roles: ProcessRole[] = ["web", "worker", "migration", "all"];
      const hosting = roles.filter(roleRunsWorkers);
      expect(hosting).toEqual(["worker", "all"]);
    });
  });
});

describe("roleSatisfiesRunIn", () => {
  describe("given a subscriber with no runIn filter", () => {
    it("runs under any role (undefined filter means run everywhere)", () => {
      expect(roleSatisfiesRunIn({ runIn: undefined, processRole: "web" })).toBe(
        true,
      );
      expect(
        roleSatisfiesRunIn({ runIn: undefined, processRole: "worker" }),
      ).toBe(true);
      expect(roleSatisfiesRunIn({ runIn: undefined, processRole: "all" })).toBe(
        true,
      );
    });
  });

  describe("given the process role is undefined", () => {
    it("does not exclude the subscriber (backwards-compatible run-everywhere)", () => {
      expect(
        roleSatisfiesRunIn({ runIn: ["worker"], processRole: undefined }),
      ).toBe(true);
    });
  });

  describe("given the in-process 'all' role", () => {
    // The regression the P0 fix guards: a worker-only subscriber MUST run under
    // "all", otherwise `pnpm dev` boots the worker stack but every
    // runIn-gated subscriber is silently skipped.
    it("satisfies a worker-only runIn filter", () => {
      expect(
        roleSatisfiesRunIn({ runIn: ["worker"], processRole: "all" }),
      ).toBe(true);
    });

    it("satisfies a web+worker runIn filter", () => {
      expect(
        roleSatisfiesRunIn({ runIn: ["web", "worker"], processRole: "all" }),
      ).toBe(true);
    });

    it("satisfies even a web-only runIn filter (all plays every role)", () => {
      expect(roleSatisfiesRunIn({ runIn: ["web"], processRole: "all" })).toBe(
        true,
      );
    });
  });

  describe("given a dedicated role and a matching filter", () => {
    it("runs a worker subscriber under the worker role", () => {
      expect(
        roleSatisfiesRunIn({ runIn: ["worker"], processRole: "worker" }),
      ).toBe(true);
    });

    it("runs a web+worker subscriber under the web role", () => {
      expect(
        roleSatisfiesRunIn({ runIn: ["web", "worker"], processRole: "web" }),
      ).toBe(true);
    });
  });

  describe("given a dedicated role and a non-matching filter", () => {
    it("excludes a worker-only subscriber under the web role", () => {
      expect(
        roleSatisfiesRunIn({ runIn: ["worker"], processRole: "web" }),
      ).toBe(false);
    });

    it("excludes a web-only subscriber under the worker role", () => {
      expect(
        roleSatisfiesRunIn({ runIn: ["web"], processRole: "worker" }),
      ).toBe(false);
    });

    it("excludes a worker-only subscriber under the migration role", () => {
      expect(
        roleSatisfiesRunIn({ runIn: ["worker"], processRole: "migration" }),
      ).toBe(false);
    });
  });
});
