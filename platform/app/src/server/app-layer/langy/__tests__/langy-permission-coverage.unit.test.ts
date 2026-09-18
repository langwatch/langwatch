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
 * Runs in the UNIT lane: this reads the in-memory route registry and needs no
 * database. A drift guard is worth most when it runs often.
 */
import { describe, expect, it } from "vitest";

import { LANGY_CANDIDATE_PERMISSIONS } from "../langyApiKey";
import { classifyForLangy } from "../langyPermissionPolicy";
import {
  experimentRoutePermissions,
  permissionsDemandedByRoutes,
} from "./helpers/routePermissions";

/**
 * Permissions a route demands, the policy says Langy may hold, and the mint
 * nonetheless does not ask for — each rendered with the routes that demand it,
 * so a failure names the route rather than just the grain.
 */
function grantedByPolicyButNotByTheMint(): string[] {
  const granted = new Set<string>(LANGY_CANDIDATE_PERMISSIONS);

  return [...permissionsDemandedByRoutes()]
    .filter(([permission]) => !granted.has(permission))
    .filter(
      ([permission]) => classifyForLangy(permission).disposition === "granted",
    )
    .map(
      ([permission, routes]) =>
        `${permission} — demanded by ${routes.join(", ")}`,
    );
}

/** Permissions the mint asks for that the policy says Langy must never hold. */
function askedForButExcludedByPolicy(): string[] {
  return LANGY_CANDIDATE_PERMISSIONS.flatMap((permission) => {
    const verdict = classifyForLangy(permission);
    return verdict.disposition === "excluded"
      ? [`${permission} — ${verdict.reason}`]
      : [];
  });
}

describe("Langy permission coverage", () => {
  describe("given every permission the mounted API routes demand", () => {
    describe("when the policy says Langy should be able to hold it", () => {
      it("is granted by the candidate list, so no Langy tool is refused a permission it should have", async () => {
        // Named so the failure reads as an instruction, not a puzzle: add the
        // line to LANGY_CANDIDATE_PERMISSIONS, or record why not in
        // langyPermissionPolicy.ts.
        expect(
          grantedByPolicyButNotByTheMint(),
          "Routes demand these permissions and the Langy policy says Langy " +
            "should hold them, but LANGY_CANDIDATE_PERMISSIONS omits them. " +
            "Add each to the list, or exclude the family/action in " +
            "langyPermissionPolicy.ts with a reason",
        ).toEqual([]);
      });
    });

    describe("when the policy says Langy must never hold it", () => {
      it("is absent from the candidate list, so widening the list cannot quietly cross a line the policy drew", async () => {
        expect(
          askedForButExcludedByPolicy(),
          "LANGY_CANDIDATE_PERMISSIONS grants permissions the Langy policy " +
            "excludes. Either the grant is wrong, or the policy in " +
            "langyPermissionPolicy.ts no longer reflects the intended line",
        ).toEqual([]);
      });
    });
  });

  // A route marked with the wrong `credential` is INVISIBLE rather than wrong:
  // the sweeps skip it and stay green while checking less than they claim.
  // That is not hypothetical — both API-key policies in experiments-v3 shipped
  // as `session` for one commit, which silently dropped `evaluations:view` and
  // `evaluations:create` from the session-key suite. Nothing caught it, because
  // the one permission the guard named came from a different policy kind.
  //
  // So pin the credential classification itself: every grain the experiment
  // surface enforces for a KEY-bearing caller has to be reachable as one.
  describe("given the experiment routes an API key can reach", () => {
    describe("when their credential classification is read back", () => {
      it("includes the run and read grains, not just the list read", () => {
        const reachable = experimentRoutePermissions();

        // From `requires("experiments:view")` — a middleware policy, so it
        // survives even a total handler-managed misclassification. On its own
        // it proves nothing about `credential`.
        expect(reachable).toContain("experiments:view");
        // These come ONLY from handler-managed policies that must be marked
        // `apiKey`. If either is missing, a route is classified as unreachable
        // by a key when the CLI reaches it every day.
        expect(reachable).toContain("evaluations:view");
        expect(reachable).toContain("evaluations:create");
        // The session-only execute route must NOT leak in: Langy holds a key,
        // never a browser session, and that route demands the manage grain.
        expect(reachable).not.toContain("evaluations:manage");
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
        const demanded = permissionsDemandedByRoutes();

        const experimentGrains = [...demanded.entries()]
          .filter(([, routes]) =>
            routes.some((r) => r.includes("/api/experiments")),
          )
          .map(([permission]) => permission);

        // The list endpoint's dedicated read must be there...
        expect(experimentGrains).toContain("experiments:view");
        // ...and every experiment-route permission Langy is meant to hold must
        // actually be held. `evaluations:manage` on the session-only execute
        // route is correctly excluded, so it is filtered out by the policy.
        const shouldHold = experimentGrains.filter(
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
