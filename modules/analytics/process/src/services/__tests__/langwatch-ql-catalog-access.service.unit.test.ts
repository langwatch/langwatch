import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi, AuthzScopeRef } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import { isAccessHeld } from "../../rules/lwql-catalogue.rules.ts";
import { LWQL_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLCatalogAccessService } from "../langwatch-ql-catalog-access.service.ts";
import {
  authzGranting,
  EVERY_CATALOGUE_PERMISSION,
  type AuthzCheck,
} from "./lwql-catalogue-access.fixture.ts";

const PROJECT_A = {
  type: "project",
  id: "proj-a",
  teamId: "team-1",
  organizationId: "org-1",
} as const;
const PROJECT_B = {
  type: "project",
  id: "proj-b",
  teamId: "team-1",
  organizationId: "org-1",
} as const;
const PROJECT_OTHER_ORG = {
  type: "project",
  id: "proj-z",
  teamId: "team-9",
  organizationId: "org-2",
} as const;
const MEMBER = { type: "user", id: "user-1" } as const;

/** Grants exactly the listed `permission@scopeType:scopeId` entries. */
const granting =
  (grants: readonly string[]) =>
  (check: AuthzCheck): boolean =>
    grants.includes(`${check.permission}@${check.scope.type}:${check.scope.id}`);

function serviceGranting(grants: readonly string[]) {
  const { authz, checks } = authzGranting({ grants: granting(grants) });
  return { service: LangWatchQLCatalogAccessService.create({ authz }), checks };
}

function resolveAt(
  service: LangWatchQLCatalogAccessService,
  scope: Extract<AuthzScopeRef, { type: "project" }>,
) {
  return service.resolveAccessibleCatalog({ principal: MEMBER, scope, catalog: LWQL_CATALOG });
}

describe("LangWatchQLCatalogAccessService", () => {
  describe("given the project itself as the principal", () => {
    /** @scenario "A job the project runs for itself resolves the whole catalogue" */
    it("resolves every permission the catalogue names without asking authz", async () => {
      const { service, checks } = serviceGranting([]);

      const access = await service.resolveAccessibleCatalog({
        principal: { type: "project" },
        scope: PROJECT_A,
        catalog: LWQL_CATALOG,
      });

      expect(access).toEqual(EVERY_CATALOGUE_PERMISSION);
      expect(checks).toEqual([]);
    });
  });

  describe("given a member at project tier", () => {
    it("drops a project permission the member lacks", async () => {
      const { service } = serviceGranting(["analytics:view@project:proj-a"]);

      await expect(resolveAt(service, PROJECT_A)).resolves.toEqual({
        permissions: ["analytics:view"],
      });
    });

    it("does not carry a grant held in another project", async () => {
      const { service } = serviceGranting([
        "analytics:view@project:proj-a",
        "virtualKeys:view@project:proj-b",
      ]);

      const inA = await resolveAt(service, PROJECT_A);
      const inB = await resolveAt(service, PROJECT_B);

      expect(inA.permissions).not.toContain("virtualKeys:view");
      expect(inB.permissions).toContain("virtualKeys:view");
    });

    it("asks every project and team permission in one batch", async () => {
      const { authz, batches } = authzGranting({ grants: () => true });

      await resolveAt(LangWatchQLCatalogAccessService.create({ authz }), PROJECT_A);

      expect(batches).toHaveLength(1);
    });
  });

  describe("given an organization-tier permission", () => {
    it("asks it at the project's organization, never at the project", async () => {
      const { service, checks } = serviceGranting(["governanceCost:view@organization:org-1"]);

      const access = await resolveAt(service, PROJECT_A);

      expect(access.permissions).toContain("governanceCost:view");
      expect(
        checks.filter((check) => check.permission === "governanceCost:view").map((c) => c.scope),
      ).toEqual([{ type: "organization", id: "org-1" }]);
    });

    it("drops it for a project of another organization", async () => {
      const { service } = serviceGranting(["governanceCost:view@organization:org-1"]);

      const access = await resolveAt(service, PROJECT_OTHER_ORG);

      expect(access.permissions).not.toContain("governanceCost:view");
    });

    it("drops it when the member holds it only at the project", async () => {
      const { service } = serviceGranting(["governanceCost:view@project:proj-a"]);

      const access = await resolveAt(service, PROJECT_A);

      expect(access.permissions).not.toContain("governanceCost:view");
    });
  });

  describe("given an API key", () => {
    it("asks authz as the key, which bounds it by its owner", async () => {
      const { service, checks } = serviceGranting([]);

      await service.resolveAccessibleCatalog({
        principal: { type: "apiKey", id: "key-1" },
        scope: PROJECT_A,
        catalog: LWQL_CATALOG,
      });

      expect(checks.length).toBeGreaterThan(0);
      expect(checks.every((check) => check.principal.type === "apiKey")).toBe(true);
    });
  });

  describe("when the authz check throws", () => {
    it("refuses rather than resolving a narrower or wider catalogue", async () => {
      const service = LangWatchQLCatalogAccessService.create({
        authz: createApiFixture<AuthzApi>({
          can: () => Promise.reject(new Error("grants head unreachable")),
          canBatchPermissionsByIds: () => Promise.reject(new Error("grants head unreachable")),
        }),
      });

      await expect(resolveAt(service, PROJECT_A)).rejects.toThrow("grants head unreachable");
    });
  });
});

describe("isAccessHeld", () => {
  const held = new Set(["analytics:view"]);

  it("needs every permission of allOf", () => {
    expect(isAccessHeld({ access: { allOf: ["analytics:view", "virtualKeys:view"] }, held })).toBe(
      false,
    );
  });

  it("needs one permission of anyOf", () => {
    expect(isAccessHeld({ access: { anyOf: ["virtualKeys:view", "analytics:view"] }, held })).toBe(
      true,
    );
  });
});
