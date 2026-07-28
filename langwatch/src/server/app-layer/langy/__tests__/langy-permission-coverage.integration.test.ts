/**
 * @vitest-environment node
 *
 * @see specs/langy/langy-session-key.feature
 *
 * The guarantee: no permission any route demands can go UNCLASSIFIED with
 * respect to Langy. Either the policy says Langy should hold it and the
 * candidate list grants it, or the policy says it should not and the list
 * withholds it. There is no third state, and in particular there is no
 * "nobody thought about it" — which is the state that produced the same
 * production 403 three times (`project:view`, `scenarios:create`,
 * `experiments:view`).
 *
 * This triangulates three facts that are maintained independently, so no two
 * of them can drift into agreement while being wrong together:
 *
 *   1. the ROUTE REGISTRY — what the API actually demands at the door
 *   2. `classifyForLangy`  — what Langy is allowed to be delegated
 *   3. `LANGY_CANDIDATE_PERMISSIONS` — what the mint actually asks for
 *
 * A new route requiring a new permission fails here until someone decides,
 * naming the route and the permission, rather than reaching a user as a 403.
 *
 * Requires: nothing beyond module loading — the registry is populated as a
 * side effect of importing the composed router.
 */
import { describe, expect, it } from "vitest";

import { policyPermissions } from "~/server/api/security/access-policy";
import { allRegisteredRoutes } from "~/server/api/security/route-registry";
import { LANGY_CANDIDATE_PERMISSIONS } from "../langyApiKey";
import { classifyForLangy } from "../langyPermissionPolicy";

/** The registry fills as the app modules load, so the router comes first. */
const loadRouter = async (): Promise<void> => {
  await import("~/server/api-router");
};

/**
 * Every permission the mounted API demands, mapped to the routes demanding it
 * so a failure can name the endpoint rather than just the permission string.
 */
async function permissionsDemandedByRoutes(): Promise<Map<string, string[]>> {
  await loadRouter();
  const demanded = new Map<string, string[]>();
  for (const route of allRegisteredRoutes()) {
    for (const permission of policyPermissions(route.policy)) {
      const where = `${route.method} ${route.path}`;
      demanded.set(permission, [...(demanded.get(permission) ?? []), where]);
    }
  }
  return demanded;
}

describe("Langy permission coverage", () => {
  describe("given every permission the mounted API routes demand", () => {
    describe("when the policy says Langy should be able to hold it", () => {
      it("is granted by the candidate list, so no Langy tool is refused a permission it should have", async () => {
        const demanded = await permissionsDemandedByRoutes();
        const granted = new Set<string>(LANGY_CANDIDATE_PERMISSIONS);

        const missing: string[] = [];
        for (const [permission, routes] of demanded) {
          if (classifyForLangy(permission).disposition !== "granted") continue;
          if (granted.has(permission)) continue;
          missing.push(`${permission} — demanded by ${routes.join(", ")}`);
        }

        // Named so the failure reads as an instruction, not a puzzle: add the
        // line to LANGY_CANDIDATE_PERMISSIONS, or record why not in
        // langyPermissionPolicy.ts.
        expect(
          missing,
          "Routes demand these permissions and the Langy policy says Langy " +
            "should hold them, but LANGY_CANDIDATE_PERMISSIONS omits them. " +
            "Add each to the list, or exclude the family/action in " +
            "langyPermissionPolicy.ts with a reason",
        ).toEqual([]);
      });
    });

    describe("when the policy says Langy must never hold it", () => {
      it("is absent from the candidate list, so widening the list cannot quietly cross a line the policy drew", async () => {
        await loadRouter();

        const wrongly: string[] = [];
        for (const permission of LANGY_CANDIDATE_PERMISSIONS) {
          const verdict = classifyForLangy(permission);
          if (verdict.disposition === "excluded") {
            wrongly.push(`${permission} — ${verdict.reason}`);
          }
        }

        expect(
          wrongly,
          "LANGY_CANDIDATE_PERMISSIONS grants permissions the Langy policy " +
            "excludes. Either the grant is wrong, or the policy in " +
            "langyPermissionPolicy.ts no longer reflects the intended line",
        ).toEqual([]);
      });
    });
  });

  // The regression that started this: the reported 403 was `experiments:view`
  // on `GET /api/experiments`, and the run route asked `evaluations:manage` —
  // a grain no least-privilege key can hold. Both are covered by the sweeps
  // above; pinning them by name documents the incident at the point of test.
  describe("given the experiment surface that regressed", () => {
    describe("when its routes are read out of the registry", () => {
      it("demands only permissions the Langy key carries", async () => {
        const demanded = await permissionsDemandedByRoutes();

        const experimentRoutePermissions = [...demanded.entries()]
          .filter(([, routes]) =>
            routes.some((r) => r.includes("/api/experiments")),
          )
          .map(([permission]) => permission);

        // The list endpoint's dedicated read must be there...
        expect(experimentRoutePermissions).toContain("experiments:view");
        // ...and every experiment-route permission Langy is meant to hold must
        // actually be held. `evaluations:manage` on the session-only execute
        // route is correctly excluded, so it is filtered out by the policy.
        const shouldHold = experimentRoutePermissions.filter(
          (p) => classifyForLangy(p).disposition === "granted",
        );
        expect(shouldHold.length).toBeGreaterThan(0);
        for (const permission of shouldHold) {
          expect(LANGY_CANDIDATE_PERMISSIONS).toContain(permission);
        }
      });
    });
  });
});
