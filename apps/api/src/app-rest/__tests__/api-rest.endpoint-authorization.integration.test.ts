/**
 * @see specs/security/api-endpoint-authorization.feature
 * Every endpoint this process mounts is registered through the secured app builder, so a
 * route added through raw Hono never reaches the registry and fails here. No allowlist.
 */
import {
  builtinRoleGrants,
  permissionResource,
  type BuiltinRoleKey,
} from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import { composeOpenApiDocumentSurface } from "../../tasks/openapi-document/openapi-document.surface";
import { allRegisteredRoutes } from "../index";

/**
 * A method-"ALL" route on a wildcard path is app-level middleware, a sub-app mount, or a
 * catch-all that terminates the request inside its own framework. None is an enumerable
 * endpoint, so it is excluded from both sides of the cross-check.
 */
function isUnenumerableMount(method: string, path: string): boolean {
  return method.toUpperCase() === "ALL" && path.includes("*");
}

/** The composed process surface, built once: composition registers as a side effect. */
const surface = composeOpenApiDocumentSurface();

function liveEndpoints(): Set<string> {
  const live = new Set<string>();
  for (const route of surface.app.routes) {
    if (isUnenumerableMount(route.method, route.path)) continue;
    live.add(`${route.method.toUpperCase()} ${route.path}`);
  }
  return live;
}

/**
 * A registered route answers at its own path and, when it has one, at the canonical
 * `/api/v1` twin. Either address proves the policy covers what the router serves.
 */
function registeredAddresses(): Set<string> {
  const registered = new Set<string>();
  for (const route of allRegisteredRoutes()) {
    registered.add(`${route.method} ${route.path}`);
    if (route.canonicalPath) registered.add(`${route.method} ${route.canonicalPath}`);
  }
  return registered;
}

describe("given the fully composed API process router", () => {
  describe("when every mounted endpoint is enumerated", () => {
    /** @scenario "The composed router has no route without a registered policy" */
    it("registers a policy for every concrete endpoint", () => {
      const registered = registeredAddresses();
      const unclassified = [...liveEndpoints()].filter((key) => !registered.has(key));

      expect(
        unclassified,
        "These endpoints have no declared access policy. Register them through the " +
          "secured app builder (createProjectApp / createOrgApp / createServiceApp plus " +
          `.access(...)). There is no allowlist:\n${unclassified.join("\n")}`,
      ).toEqual([]);
    });
  });

  describe("when a route is registered through the builder", () => {
    /** @scenario "A public or internal route declares a documented reason" */
    it("declares a non-empty reason for every public, internal or handler-managed policy", () => {
      const offenders = allRegisteredRoutes().filter((route) => {
        const policy = route.policy;
        if (
          policy.kind === "public" ||
          policy.kind === "internal" ||
          policy.kind === "handlerManaged"
        ) {
          return !policy.reason || policy.reason.trim().length === 0;
        }
        return false;
      });

      expect(offenders.map((route) => `${route.method} ${route.path}`)).toEqual([]);
    });
  });

  /**
   * The grain sweep runs over the whole registry rather than a named list, because the
   * risk is not one route changing — it is a change anywhere handing a viewer a write, or
   * stranding a route no built-in role can reach.
   */
  describe("when a route's declared permission is compared to the role model", () => {
    const permissionRoutes = (): Array<{ route: string; permission: string }> =>
      allRegisteredRoutes().flatMap((route) =>
        route.policy.kind === "permission" || route.policy.kind === "apiKeyPermission"
          ? [{ route: `${route.method} ${route.path}`, permission: route.policy.permission }]
          : [],
      );

    const grants = ({ role, permission }: { role: BuiltinRoleKey; permission: string }): boolean =>
      builtinRoleGrants({ role, permission });

    /** @scenario "Every route still admits the roles that could already reach it" */
    it("admits a manage holder on every route", () => {
      const stranded = permissionRoutes().filter(
        ({ permission }) =>
          !builtinRoleGrants({
            role: "admin",
            permission,
          }) &&
          !builtinRoleGrants({
            role: "org-admin",
            permission,
          }),
      );

      expect(
        stranded.map((entry) => `${entry.route} -> ${entry.permission}`),
        "These routes ask for a grain no administrator's manage implies, so moving to " +
          "them silently removed everyone who held it:",
      ).toEqual([]);
    });

    /** @scenario "A read-only role gains no write from a finer grain" */
    it("refuses a project viewer on every route that is not a read", () => {
      const leaked = permissionRoutes().filter(
        ({ permission }) => !permission.endsWith(":view") && grants({ role: "viewer", permission }),
      );

      expect(
        leaked.map((entry) => `${entry.route} -> ${entry.permission}`),
        "A project viewer can reach these non-read routes. A finer grain must never be " +
          "one a read-only role happens to hold:",
      ).toEqual([]);
    });

    /**
     * The lite member is the only built-in bag holding a bare create or update without
     * the manage that would imply it, so the viewer sweep above cannot see this class.
     */
    /** @scenario "A read-only role gains no write from a finer grain" */
    it("refuses a lite member on every route that is not a read or an annotation write", () => {
      const leaked = permissionRoutes().filter(
        ({ permission }) =>
          !permission.endsWith(":view") &&
          permissionResource(permission) !== "annotations" &&
          grants({ role: "lite-member", permission }),
      );

      expect(
        leaked.map((entry) => `${entry.route} -> ${entry.permission}`),
        "A lite member can reach these non-read routes:",
      ).toEqual([]);
    });

    /** @scenario "Every declared permission is reachable by a built-in role" */
    it("keeps every route reachable by a built-in administrator", () => {
      const unreachable = permissionRoutes().filter(
        ({ permission }) =>
          !grants({ role: "admin", permission }) && !grants({ role: "org-admin", permission }),
      );

      expect(
        unreachable.map((entry) => `${entry.route} -> ${entry.permission}`),
        "No built-in administrator grants these, so the routes are unreachable for real " +
          "users — the opposite failure to asking for too much:",
      ).toEqual([]);
    });

    /** @scenario "Running a scenario suite does not require administering it" */
    it("lets a read-and-write scenarios credential run a suite but not archive it", () => {
      const readAndWrite = new Set(["scenarios:view", "scenarios:create", "scenarios:update"]);
      const declared = new Map(permissionRoutes().map((entry) => [entry.route, entry.permission]));

      const run = declared.get("POST /api/suites/:id/run");
      const archive = declared.get("DELETE /api/suites/:id");
      expect(run, "the suite run route must be registered").toBeDefined();
      expect(archive, "the suite archive route must be registered").toBeDefined();

      expect(readAndWrite.has(run!)).toBe(true);
      expect(readAndWrite.has(archive!)).toBe(false);
    });
  });
});
