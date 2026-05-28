/**
 * @vitest-environment node
 *
 * @see specs/security/api-endpoint-authorization.feature
 *
 * The regression-proof guarantee: every endpoint mounted in the fully composed
 * API router is accounted for — it is EITHER registered through the type-safe
 * SecuredApp builder (so its access policy is enforced and recorded) OR it is
 * an explicitly documented legacy route pending migration. A new route added
 * through raw Hono with no policy appears in neither set and fails this test.
 *
 * This closes the escape hatch the SecuredApp type-level guarantee cannot reach
 * (a developer bypassing the builder), so no human or agent can add an
 * unclassified, unauthorized endpoint to the surface by accident.
 */
import { describe, expect, it } from "vitest";

import { allRegisteredRoutes } from "../route-registry";
import { LEGACY_UNSECURED_ROUTES } from "../legacy-unsecured-routes";

const liveEndpoints = async (): Promise<Set<string>> => {
  const { createApiRouter } = await import("~/server/api-router");
  const router = createApiRouter();
  const set = new Set<string>();
  for (const r of (router as unknown as { routes: { method: string; path: string }[] }).routes) {
    set.add(`${r.method.toUpperCase()} ${r.path}`);
  }
  return set;
};

describe("API router endpoint authorization guarantee", () => {
  describe("when the fully composed router is introspected", () => {
    /** @scenario "The composed router has no route without a registered policy" */
    it("has no endpoint that is neither SecuredApp-registered nor explicitly documented", async () => {
      const live = await liveEndpoints();
      const registered = new Set(
        allRegisteredRoutes().map((r) => `${r.method} ${r.path}`),
      );

      const unclassified = [...live].filter(
        (key) => !registered.has(key) && !LEGACY_UNSECURED_ROUTES.has(key),
      );

      expect(
        unclassified,
        `These endpoints have no access policy. Register them through ` +
          `createProjectApp/createOrgApp and .access(...) (preferred), or — if ` +
          `genuinely service/public — add them to LEGACY_UNSECURED_ROUTES with a ` +
          `justification:\n${unclassified.join("\n")}`,
      ).toEqual([]);
    });

    it("does not list a migrated (SecuredApp-registered) route in the legacy allowlist", async () => {
      const registered = allRegisteredRoutes().map((r) => `${r.method} ${r.path}`);
      const stillInLegacy = registered.filter((key) =>
        LEGACY_UNSECURED_ROUTES.has(key),
      );
      expect(
        stillInLegacy,
        `These routes are now SecuredApp-registered and must be removed from ` +
          `LEGACY_UNSECURED_ROUTES:\n${stillInLegacy.join("\n")}`,
      ).toEqual([]);
    });

    it("has no stale legacy allowlist entry that no longer exists in the router", async () => {
      const live = await liveEndpoints();
      const stale = [...LEGACY_UNSECURED_ROUTES].filter((key) => !live.has(key));
      expect(
        stale,
        `These allowlist entries no longer match any mounted route (route ` +
          `removed or renamed) — delete them from LEGACY_UNSECURED_ROUTES:\n${stale.join("\n")}`,
      ).toEqual([]);
    });
  });

  describe("every SecuredApp-registered route", () => {
    it("is actually mounted in the composed router", async () => {
      const live = await liveEndpoints();
      const missing = allRegisteredRoutes()
        .map((r) => `${r.method} ${r.path}`)
        .filter((key) => !live.has(key));
      expect(
        missing,
        `These routes were registered with a policy but are not mounted — ` +
          `the registry path does not match the router path:\n${missing.join("\n")}`,
      ).toEqual([]);
    });

    /** @scenario "A public or internal route declares a documented reason" */
    it("declares a non-empty reason for every public or internal policy", () => {
      const offenders = allRegisteredRoutes().filter((r) => {
        if (r.policy.kind === "public" || r.policy.kind === "internal") {
          return !r.policy.reason || r.policy.reason.trim().length === 0;
        }
        return false;
      });
      expect(offenders.map((o) => `${o.method} ${o.path}`)).toEqual([]);
    });
  });
});
