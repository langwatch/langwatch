/**
 * @vitest-environment node
 *
 * @see specs/experiments-v3/cli-comparison-target.feature
 *
 * The experiments family gates on three different grains, and which one each
 * route asks for is the whole of its authorization story: the handler passes
 * the same permission to `authenticateRequest`, and `enforceApiKeyCeiling`
 * refuses any key that does not hold it. Asserting the declared policy is
 * therefore asserting what a key must carry to be let through, and it fails
 * the moment a route is widened or narrowed by accident.
 */
import { describe, expect, it } from "vitest";

import { getRoutePolicy } from "~/server/api/security/route-registry";

/**
 * The registry fills as a side effect of the route module loading, so anything
 * asserting over it has to import that module first.
 */
const loadRoutes = async (): Promise<void> => {
  await import("~/server/routes/experiments-v3");
};

const permissionsFor = async (
  method: string,
  path: string,
): Promise<readonly string[] | undefined> => {
  await loadRoutes();
  const route = getRoutePolicy(method, path);
  return (route?.policy as { permissions?: readonly string[] } | undefined)
    ?.permissions;
};

describe("experiments API access policies", () => {
  describe("when a route only reads runs", () => {
    it("asks for the view permission", async () => {
      await expect(
        permissionsFor("GET", "/api/experiments/runs"),
      ).resolves.toEqual(["evaluations:view"]);
    });
  });

  describe("when a route starts a run", () => {
    it("asks for the create permission, not the manage one", async () => {
      await expect(
        permissionsFor("POST", "/api/experiments/:slug/run"),
      ).resolves.toEqual(["evaluations:create"]);
    });
  });

  describe("when a route attaches a comparison", () => {
    /** @scenario "Rejects a request without the evaluations:manage permission" */
    it("asks for the manage permission, so a run-only key is refused", async () => {
      await expect(
        permissionsFor("POST", "/api/experiments/:slug/comparison"),
      ).resolves.toEqual(["evaluations:manage"]);
    });
  });
});
