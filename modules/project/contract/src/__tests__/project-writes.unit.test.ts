/**
 * ADR-175 decision 8: an aggregate is read only. A write declared under a
 * project-tier write permission is refused on it; managing the aggregate itself
 * (its rule, its name, archiving it) is not a write under its tenant.
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import {
  AGGREGATE_WRITE_EXEMPT_RESOURCES,
  assertProjectKindAcceptsWrites,
  projectKindAcceptsWrites,
  writesUnderProject,
} from "../project-writes.ts";
import { PROJECT_KIND } from "../project.ts";

const refusalOf = (run: () => void): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return void 0;
};

describe("writesUnderProject", () => {
  describe("when the permission only reads", () => {
    it("is not a write", () => {
      expect(writesUnderProject("traces:view")).toBe(false);
      expect(writesUnderProject("virtualKeys:viewOtherPersonal")).toBe(false);
    });
  });

  describe("when the permission writes data under the project", () => {
    it("is a write", () => {
      for (const permission of [
        "traces:update",
        "traces:share",
        "workflows:create",
        "experiments:update",
        "datasets:manage",
        "annotations:create",
        "prompts:create",
        "evaluations:manage",
        "analytics:create",
      ] as const) {
        expect(writesUnderProject(permission), permission).toBe(true);
      }
    });
  });

  describe("when the permission manages the project or what holds it", () => {
    it("is exempt, so the aggregate itself can be managed", () => {
      expect(AGGREGATE_WRITE_EXEMPT_RESOURCES).toEqual(["organization", "project", "team"]);
      for (const permission of [
        "project:update",
        "project:delete",
        "project:manage",
        "organization:manage",
        "team:manage",
      ] as const) {
        expect(writesUnderProject(permission), permission).toBe(false);
      }
    });
  });
});

describe("assertProjectKindAcceptsWrites", () => {
  describe("when the project is an aggregate", () => {
    it("refuses with the read-only code, answered forbidden", () => {
      const refusal = refusalOf(() => assertProjectKindAcceptsWrites(PROJECT_KIND.AGGREGATE));

      expect(HandledError.isHandled(refusal) && refusal.code).toBe(
        "aggregate_project_is_read_only",
      );
      expect(HandledError.isHandled(refusal) && refusal.httpStatus).toBe(403);
      expect(projectKindAcceptsWrites(PROJECT_KIND.AGGREGATE)).toBe(false);
    });
  });

  describe("when the project is any other kind, or unknown", () => {
    it("lets the write through", () => {
      for (const kind of [
        PROJECT_KIND.APPLICATION,
        PROJECT_KIND.INTERNAL_GOVERNANCE,
        null,
        void 0,
      ]) {
        expect(refusalOf(() => assertProjectKindAcceptsWrites(kind))).toBeUndefined();
        expect(projectKindAcceptsWrites(kind)).toBe(true);
      }
    });
  });
});
