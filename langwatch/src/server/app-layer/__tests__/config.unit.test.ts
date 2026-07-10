import { describe, expect, it } from "vitest";
import { type ProcessRole, roleRunsWorkers } from "../config";

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
    it("treats exactly worker and all as worker-hosting roles", () => {
      const roles: ProcessRole[] = ["web", "worker", "migration", "all"];
      const hosting = roles.filter(roleRunsWorkers);
      expect(hosting).toEqual(["worker", "all"]);
    });
  });
});
