/**
 * ADR-144: the aggregate is read only in v1. Every mutation declared under a
 * write permission on a project-tier resource is refused on an aggregate
 * before its handler runs; managing the aggregate itself (its rule, its
 * name, archiving it) is not a write under its tenant and stays open.
 */

import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";
import {
  AGGREGATE_WRITE_EXEMPT_RESOURCES,
  assertProjectAcceptsWrites,
  writesUnderProject,
} from "../project-write-guard";

const kindsFor = (kind: string | null) => ({
  kindOf: async () => kind,
  kindsOf: async () => new Map<string, string>(),
});

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
      expect(AGGREGATE_WRITE_EXEMPT_RESOURCES).toEqual([
        "organization",
        "project",
        "team",
      ]);
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

describe("assertProjectAcceptsWrites", () => {
  describe("when the project is an aggregate", () => {
    it("refuses with the read-only code", async () => {
      const refusal = await assertProjectAcceptsWrites({
        kinds: kindsFor("aggregate"),
        projectId: "proj_company_view",
      }).catch((error: unknown) => error);

      expect(HandledError.isHandled(refusal) && refusal.code).toBe(
        "aggregate_project_is_read_only",
      );
    });
  });

  describe("when the project is any other kind, or unknown", () => {
    it("lets the write through", async () => {
      for (const kind of ["application", "internal_governance", null]) {
        await expect(
          assertProjectAcceptsWrites({
            kinds: kindsFor(kind),
            projectId: "proj_any",
          }),
        ).resolves.toBeUndefined();
      }
    });
  });
});
