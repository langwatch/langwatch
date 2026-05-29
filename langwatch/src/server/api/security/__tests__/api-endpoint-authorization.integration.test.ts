/**
 * @vitest-environment node
 *
 * @see specs/security/api-endpoint-authorization.feature
 *
 * The regression-proof guarantee: every concrete endpoint mounted in the fully
 * composed API router is registered through the type-safe SecuredApp builder,
 * so its access policy is declared and recorded. A new route added through raw
 * Hono with no policy will not appear in the registry and fails this test.
 *
 * This closes the escape hatch the SecuredApp type-level guarantee cannot reach
 * (a developer bypassing the builder), so no human or agent can add an
 * unclassified, unauthorized endpoint to the surface by accident. There is no
 * legacy allowlist: the migration is complete and every family is on the builder.
 */
import { describe, expect, it } from "vitest";

import { allRegisteredRoutes } from "../route-registry";

/**
 * Concrete HTTP-method endpoints mounted in the composed router. Method "ALL"
 * entries are app-level middleware (`.use`) and sub-app mounts (`.route`) and
 * the two legacy OAuth-callback rewrite shims — not data endpoints — so they
 * are excluded from the per-route policy guarantee by construction.
 */
const liveEndpoints = async (): Promise<Set<string>> => {
  const { createApiRouter } = await import("~/server/api-router");
  const router = createApiRouter();
  const set = new Set<string>();
  for (const r of (router as unknown as { routes: { method: string; path: string }[] }).routes) {
    if (r.method.toUpperCase() === "ALL") continue;
    set.add(`${r.method.toUpperCase()} ${r.path}`);
  }
  return set;
};

describe("API router endpoint authorization guarantee", () => {
  describe("when the fully composed router is introspected", () => {
    /** @scenario "The composed router has no route without a registered policy" */
    it("registers a policy for every concrete endpoint through SecuredApp", async () => {
      const live = await liveEndpoints();
      const registered = new Set(
        allRegisteredRoutes().map((r) => `${r.method} ${r.path}`),
      );

      const unclassified = [...live].filter((key) => !registered.has(key));

      expect(
        unclassified,
        `These endpoints have no declared access policy. Register them through ` +
          `the SecuredApp builder: createProjectApp/createOrgApp/createServiceApp ` +
          `+ .access(...). There is no allowlist — every route must declare a ` +
          `policy:\n${unclassified.join("\n")}`,
      ).toEqual([]);
    });

    it("mounts every SecuredApp-registered route in the composed router", async () => {
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
  });

  describe("when a route is registered through SecuredApp", () => {
    /** @scenario "A public or internal route declares a documented reason" */
    it("declares a non-empty reason for every public, internal, or handler-managed policy", () => {
      const offenders = allRegisteredRoutes().filter((r) => {
        if (
          r.policy.kind === "public" ||
          r.policy.kind === "internal" ||
          r.policy.kind === "handlerManaged"
        ) {
          return !r.policy.reason || r.policy.reason.trim().length === 0;
        }
        return false;
      });
      expect(offenders.map((o) => `${o.method} ${o.path}`)).toEqual([]);
    });
  });
});
