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
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  hasPermissionWithHierarchy,
  organizationRoleHasPermission,
  type Permission,
  teamRoleHasPermission,
  EXTERNAL_MEMBER_PERMISSIONS,
} from "~/server/api/rbac";
import { allRegisteredRoutes } from "../route-registry";

/**
 * The registry is populated as a side effect of the app modules loading, so
 * anything asserting over it must import the composed router first.
 */
const loadRouter = async (): Promise<void> => {
  await import("~/server/api-router");
};

/**
 * A method-"ALL" route on a wildcard path is either app-level middleware
 * (`.use`, registered at `/base/*`), a sub-app mount, or a deliberate
 * `.all("/auth/*")`-style catch-all that terminates the request inside its
 * own framework (BetterAuth). None of these are enumerable concrete
 * endpoints, so they are excluded from BOTH sides of the cross-check.
 *
 * Everything else is still audited, INCLUDING concrete-path `app.all(...)`
 * routes (real any-method endpoints) and specific-method wildcard catch-alls
 * (e.g. GET /api/sse/*, /api/trpc/*) — so neither can slip past the guarantee.
 */
const isUnenumerableMount = (method: string, path: string): boolean =>
  method.toUpperCase() === "ALL" && path.includes("*");

const liveEndpoints = async (): Promise<Set<string>> => {
  const { createApiRouter } = await import("~/server/api-router");
  const router = createApiRouter();
  const set = new Set<string>();
  for (const r of (
    router as unknown as { routes: { method: string; path: string }[] }
  ).routes) {
    if (isUnenumerableMount(r.method, r.path)) continue;
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
        .filter((r) => !isUnenumerableMount(r.method, r.path))
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

  // Regression: pull request #4913 originally classified the OAuth entry point
  // as publicEndpoint together with the protocol-mandated callback. Install is
  // session-gated (it requires a logged-in user before signing state) — keeping
  // both under one policy made the registry lie about what is actually open to
  // the internet. Pin the policies separately so a future edit can't quietly
  // re-merge them.
  describe("when the GitHub OAuth endpoints are registered", () => {
    it("treats /github-langy/install as handler-managed and /github-langy/setup as public", () => {
      const byPath = new Map(
        allRegisteredRoutes().map((r) => [`${r.method} ${r.path}`, r.policy]),
      );
      const install = byPath.get("GET /api/github-langy/install");
      const setup = byPath.get("GET /api/github-langy/setup");
      expect(install, "/install must be registered").toBeDefined();
      expect(setup, "/setup must be registered").toBeDefined();
      expect(install?.kind).toBe("handlerManaged");
      expect(setup?.kind).toBe("public");
    });
  });

  /**
   * The grain sweep — routes moved off `:manage` onto `:create` / `:update` so
   * a credential issued at the write grain is honoured instead of refused.
   *
   * These run over the WHOLE registry rather than a list of route names,
   * because the risk is not "did this one route change" — it is "did a change
   * anywhere quietly hand a viewer a write, or strand a route no role can
   * reach". Both directions are checked here, through the same
   * `hasPermissionWithHierarchy` the request path uses.
   */
  describe("when a route's declared permission is compared to the role model", () => {
    const permissionRoutes = () =>
      allRegisteredRoutes().flatMap((r) =>
        r.policy.kind === "permission" || r.policy.kind === "apiKeyPermission"
          ? [{ route: `${r.method} ${r.path}`, permission: r.policy.permission }]
          : [],
      );

    const resourceOf = (permission: string) => permission.split(":")[0]!;

    /** @scenario "Every route still admits the roles that could already reach it" */
    it("admits a manage holder on every route", async () => {
      await loadRouter();
      const stranded = permissionRoutes().filter(
        ({ permission }) =>
          !hasPermissionWithHierarchy(
            [`${resourceOf(permission)}:manage`],
            permission,
          ),
      );

      expect(
        stranded.map((s) => `${s.route} -> ${s.permission}`),
        `These routes ask for a grain that the resource's own :manage does NOT ` +
          `imply, so moving to them silently removed everyone who held :manage:`,
      ).toEqual([]);
    });

    /** @scenario "A read-only role gains no write from a finer grain" */
    it("refuses a project viewer on every route that is not a read", async () => {
      await loadRouter();
      const leaked = permissionRoutes().filter(
        ({ permission }) =>
          !permission.endsWith(":view") &&
          teamRoleHasPermission(TeamUserRole.VIEWER, permission as Permission),
      );

      expect(
        leaked.map((l) => `${l.route} -> ${l.permission}`),
        `A project VIEWER can reach these non-read routes. A finer grain must ` +
          `never be one a read-only role happens to hold:`,
      ).toEqual([]);
    });

    /** @scenario "A read-only role gains no write from a finer grain" */
    it("refuses a lite external member on every route that is not a read", async () => {
      // EXTERNAL is the only built-in bag that holds a bare `:create`/`:update`
      // WITHOUT the `:manage` that would imply it (annotations). Every other
      // role is all-`:view` or holds `:manage`, so the VIEWER sweep above
      // cannot see this class: the day someone applies the `:manage` → `:create`
      // pattern to an annotations route, a lite member silently gains a write
      // and that test stays green.
      await loadRouter();
      const leaked = permissionRoutes().filter(
        ({ permission }) =>
          !permission.endsWith(":view") &&
          EXTERNAL_MEMBER_PERMISSIONS.includes(permission as Permission),
      );

      expect(
        leaked.map((l) => `${l.route} -> ${l.permission}`),
        `An external (lite) member can reach these non-read routes:`,
      ).toEqual([]);
    });

    /** @scenario "Every declared permission is reachable by a built-in role" */
    it("keeps every route reachable by a built-in administrator", async () => {
      await loadRouter();
      const unreachable = permissionRoutes().filter(
        ({ permission }) =>
          !teamRoleHasPermission(TeamUserRole.ADMIN, permission as Permission) &&
          !organizationRoleHasPermission(
            OrganizationUserRole.ADMIN,
            permission as Permission,
          ),
      );

      expect(
        unreachable.map((u) => `${u.route} -> ${u.permission}`),
        `No built-in administrator role grants these, so the routes are ` +
          `unreachable for real users — the opposite failure to asking for too much:`,
      ).toEqual([]);
    });

    /** @scenario "Running a scenario suite does not require administering it" */
    it("lets a read-and-write scenarios credential run a suite but not archive it", async () => {
      await loadRouter();
      // Exactly what the product issues for "may work with scenarios": the
      // write grain, without the administration grain that carries delete.
      const readAndWrite = [
        "scenarios:view",
        "scenarios:create",
        "scenarios:update",
      ];

      const declared = new Map(
        permissionRoutes().map((r) => [r.route, r.permission]),
      );
      const run = declared.get("POST /api/suites/:id/run");
      const archive = declared.get("DELETE /api/suites/:id");
      expect(run, "the suite run route must be registered").toBeDefined();
      expect(archive, "the suite archive route must be registered").toBeDefined();

      expect(hasPermissionWithHierarchy(readAndWrite, run!)).toBe(true);
      expect(hasPermissionWithHierarchy(readAndWrite, archive!)).toBe(false);
    });
  });
});
