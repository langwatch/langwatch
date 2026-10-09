// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `/api/me/usage`'s address, operation id, door, permission and shared path, pinned. The CLI
 * and the desktop widget hold this path; user's `/api/me` family serves the rest of it.
 */
import { describe, expect, it } from "vitest";

import { governanceProcessModule } from "../../governance.module.ts";
import { meUsageRest } from "../me-usage.rest.ts";

const declaration = meUsageRest.router();

describe("governance's /api/me/usage family", () => {
  describe("given the declaration a process mounts", () => {
    it("keeps user's namespace, its dated addressing and its /api/v1 twin", () => {
      expect(meUsageRest.namespace).toBe("me");
      expect(declaration.addressing).toBe("dated");
      expect(declaration.v1Twin).toBe(true);
      expect(declaration.version).toBe("2026-08-07");
    });

    it("answers behind a project API key", () => {
      expect(declaration.credential).toBe("project");
    });

    it("keeps the path, operation id and permission", () => {
      expect(
        declaration.routes.map((route) => [route.path, route.operation, route.permission]),
      ).toEqual([["/usage", "getApiMeUsage", "project:view"]]);
    });

    it("declares every route as served at user's path", () => {
      expect(declaration.routes.map((route) => route.sharedPath?.owner)).toEqual(["user"]);
    });

    it("takes the resolved credential whole, because its class is half the decision", () => {
      expect(declaration.routes[0]?.middleware?.map((fact) => fact.name)).toEqual([
        "mePersonalCredential",
      ]);
    });

    it("is mounted by the governance module", () => {
      expect(governanceProcessModule.transports).toContain(meUsageRest);
    });
  });

  describe("given a half-specified usage window", () => {
    it("refuses it, rather than silently answering for the default month", () => {
      const usage = declaration.routes[0];

      expect(usage?.query?.validate({ windowStartMs: 1 })).toBe(false);
      expect(usage?.query?.validate({ windowStartMs: 2, windowEndMs: 1 })).toBe(false);
      expect(usage?.query?.validate({ windowStartMs: 1, windowEndMs: 2 })).toBe(true);
      expect(usage?.query?.validate({})).toBe(true);
    });
  });
});
