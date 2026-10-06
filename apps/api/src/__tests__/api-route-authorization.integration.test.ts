/**
 * What the installed api's REST routes declare, swept over the booted composition.
 * @vitest-environment node
 * @see specs/security/api-endpoint-authorization.feature
 */
import { allRegisteredRoutes, policyPermissions, type RegisteredRoute } from "@langwatch/api";
import { undeclaredRoutes } from "@langwatch/api/rest";
import { AUTHZ_RESOURCES, permissionSatisfiedBy } from "@langwatch/authorization";
import { builtinRoleGrants } from "@langwatch/authz-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootDescribedRest } from "./api-described-rest.fixture.ts";

type Declared = { route: string; permission: string };

/** Every permission a registered route names, with the route that names it. */
function declaredPermissions(routes: readonly RegisteredRoute[]): Declared[] {
  return routes.flatMap((route) =>
    policyPermissions(route.policy).map((permission) => ({
      route: `${route.method} ${route.path}`,
      permission,
    })),
  );
}

function resourceOf(permission: string): string {
  return permission.slice(0, permission.lastIndexOf(":"));
}

/** Whether the resource defines a manage action at all: `traces` has none to hold. */
function hasManage(permission: string): boolean {
  const actions = (AUTHZ_RESOURCES as Record<string, { actions: readonly string[] }>)[
    resourceOf(permission)
  ]?.actions;

  return actions?.includes("manage") ?? false;
}

describe("the installed api's REST routes", () => {
  let booted: Awaited<ReturnType<typeof bootDescribedRest>>;
  let declared: Declared[];

  beforeAll(async () => {
    booted = await bootDescribedRest();
    declared = declaredPermissions(allRegisteredRoutes());
  }, 240_000);

  afterAll(async () => {
    await booted?.runtime.stop();
  });

  /** @scenario "The composed router has no route without a registered policy" */
  it("mounts no route the registry does not carry a policy for", () => {
    const registry = allRegisteredRoutes();

    expect(registry.length).toBeGreaterThan(0);
    expect(undeclaredRoutes({ app: booted.rest.app, registry })).toEqual([]);
  });

  /** @scenario "Every route still admits the roles that could already reach it" */
  it("admits a holder of the resource's manage permission on every permissioned route", () => {
    const manageable = declared.filter(({ permission }) => hasManage(permission));

    expect(manageable.length).toBeGreaterThan(0);

    const refused = manageable.filter(
      ({ permission }) =>
        !permissionSatisfiedBy({
          granted: new Set([`${resourceOf(permission)}:manage`]),
          requested: permission,
        }),
    );

    expect(refused).toEqual([]);
  });

  /** @scenario "A read-only role gains no write from a finer grain" */
  it("admits a project viewer on no route that is not a read", () => {
    const writes = declared.filter(({ permission }) => !permission.endsWith(":view"));

    expect(writes.length).toBeGreaterThan(0);
    expect(
      writes.filter(({ permission }) => builtinRoleGrants({ role: "viewer", permission })),
    ).toEqual([]);
  });

  /** @scenario "Running a scenario suite does not require administering it" */
  it("admits a read-and-write scenarios credential to the suite run and refuses it the archive", () => {
    const readAndWrite = new Set(["scenarios:view", "scenarios:create", "scenarios:update"]);
    const suiteRoutes = allRegisteredRoutes().filter(({ path }) => /\/(test-)?suites\//.test(path));
    const admitted = (route: RegisteredRoute) =>
      policyPermissions(route.policy).every((permission) =>
        permissionSatisfiedBy({ granted: readAndWrite, requested: permission }),
      );
    const runs = suiteRoutes.filter(
      ({ method, path }) => method === "POST" && path.endsWith(":id/run"),
    );
    const archives = suiteRoutes.filter(
      ({ method, path }) => method === "DELETE" && path.endsWith(":id"),
    );

    expect(runs.length).toBeGreaterThan(0);
    expect(archives.length).toBeGreaterThan(0);
    expect(runs.filter((route) => !admitted(route))).toEqual([]);
    expect(archives.filter(admitted)).toEqual([]);
  });
});
