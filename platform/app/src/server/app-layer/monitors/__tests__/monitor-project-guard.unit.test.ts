/**
 * ADR-144 decision 8: a monitor on an aggregate is refused with the same
 * code every other write under an aggregate answers, on every surface that
 * asks this guard (the tRPC create and copy, the experiment monitor, and the
 * REST create).
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";
import {
  assertProjectKindRunsMonitors,
  assertProjectRunsMonitors,
} from "../monitor-project-guard";

const codeOf = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : "not handled";
  }
  return undefined;
};

describe("assertProjectKindRunsMonitors", () => {
  describe("when the project is an aggregate", () => {
    it("refuses with the read-only code", () => {
      expect(codeOf(() => assertProjectKindRunsMonitors("aggregate"))).toBe(
        "aggregate_project_is_read_only",
      );
    });
  });

  describe("when the project is any other kind", () => {
    it("lets the monitor through", () => {
      expect(codeOf(() => assertProjectKindRunsMonitors("application"))).toBe(
        undefined,
      );
      expect(codeOf(() => assertProjectKindRunsMonitors(null))).toBe(undefined);
    });
  });
});

describe("assertProjectRunsMonitors", () => {
  describe("when the project read by id is an aggregate", () => {
    it("refuses with the read-only code", async () => {
      const refusal = await assertProjectRunsMonitors({
        projects: { getKindById: async () => "aggregate" },
        projectId: "proj-1",
      }).catch((error: unknown) => error);

      expect(HandledError.isHandled(refusal) && refusal.code).toBe(
        "aggregate_project_is_read_only",
      );
    });
  });
});
