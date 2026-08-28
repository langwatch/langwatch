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

import { hasPermissionWithHierarchy } from "~/server/api/rbac";

import { LANGY_CANDIDATE_PERMISSIONS } from "../langyApiKey";
import {
  ALL_PERMISSION_ACTIONS,
  ALL_PERMISSION_FAMILIES,
  classifyForLangy,
  LANGY_ACTION_BUCKET_TOTAL,
  LANGY_AUTH_SCOPE_FAMILY_NAMES,
  LANGY_CLASSIFIED_ACTIONS,
  LANGY_CLASSIFIED_FAMILIES,
  LANGY_FAMILY_BUCKET_TOTAL,
} from "../langyPermissionPolicy";
import {
  experimentRoutePermissions,
  permissionsDemandedByRoutes,
} from "./helpers/routePermissions";

/**
 * Permissions a route demands, the policy says Langy may hold, and the mint
 * nonetheless does not ask for — each rendered with the routes that demand it,
 * so a failure names the route rather than just the grain.
 *
 * Org-exclusive permissions are handled by their own pin below rather than
 * here: `classifyForLangy` calls them `unreachable`, not `granted`, because
 * `bindingScopeCanGrant` (rbac.ts:190-196) refuses them on the PROJECT-scoped
 * binding the session key is minted with — adding them to the candidate list
 * would change nothing except the length of the list.
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

/**
 * The routes Langy cannot reach for a reason that is NOT its permission policy:
 * the policy would allow the grain, but the credential is project-scoped and
 * the resource is org-tier-only.
 *
 * Pinned as an explicit inventory rather than filtered away silently, because
 * this is the one class of Langy refusal that no amount of editing
 * `langyPermissionPolicy.ts` will fix — it needs an ORGANIZATION-scoped binding
 * on the minted key, which is a change to the credential's shape and a
 * deliberately separate decision. Until that decision is made, this list IS the
 * answer to "why did Langy say it couldn't list our org members?", and it
 * should fail loudly when it grows rather than absorbing a new refusal quietly.
 */
function reachableOnlyWithAnOrgScopedBinding(): {
  permissions: string[];
  rendered: string;
} {
  const demanded = [...permissionsDemandedByRoutes()]
    .filter(
      ([permission]) =>
        classifyForLangy(permission).disposition === "unreachable",
    )
    .sort(([a], [b]) => a.localeCompare(b));
  return {
    permissions: demanded.map(([permission]) => permission),
    // The routes render in the failure message, not the pin, so a failure
    // names the door that moved without making the pin churn on route renames.
    rendered: demanded
      .map(
        ([permission, routes]) =>
          `${permission} — demanded by ${routes.join(", ")}`,
      )
      .join("\n"),
  };
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

    describe("when the resource is organization-tier but the key is project-scoped", () => {
      it("names the routes no policy edit can unlock, so an unreachable route is never mistaken for an unclassified one", async () => {
        // An EXACT pin, not a subset check, and it fails as loudly on shrink
        // as on growth — both deliberate. Growth means a new route was put
        // behind an org-tier permission, which silently costs Langy a
        // capability the policy believes it has; shrink means a resource left
        // `ORG_EXCLUSIVE_RESOURCES` and its family's classification must be
        // re-decided (see the FULL_ACCESS_FAMILIES tripwire note).
        const unreachable = reachableOnlyWithAnOrgScopedBinding();
        expect(unreachable.permissions, unreachable.rendered).toEqual([
          "activityMonitor:view",
          "aiTools:manage",
          "aiTools:view",
          "gatewaySpend:manage",
          "gatewaySpend:view",
          "ingestionSources:view",
          "organization:view",
          "webhookEndpoints:view",
        ]);
      });
    });
  });

  // The partition checks. These are what let the rest of the policy be a
  // BLOCKLIST without being fail-open: a family or action invented next quarter
  // lands in no bucket, and CI goes red naming it, instead of it being granted
  // by default (unsafe) or refused in silence for a quarter (the original bug).
  describe("given the permission universe rbac.ts declares", () => {
    describe("when a family has not been classified for Langy", () => {
      it("fails here, so a new resource family cannot be granted by default nor refused in silence", async () => {
        expect(
          ALL_PERMISSION_FAMILIES.filter(
            (family) => !LANGY_CLASSIFIED_FAMILIES.has(family),
          ),
          "These families exist in rbac.ts `Resources` but no Langy bucket " +
            "claims them. Put each in FULL_ACCESS_FAMILIES, " +
            "AUTH_SCOPE_FAMILIES, or FULLY_EXCLUDED_FAMILIES",
        ).toEqual([]);
      });
    });

    describe("when an action has not been classified for Langy", () => {
      it("fails here, so a new action cannot be swept into the candidate list unassessed", async () => {
        expect(
          ALL_PERMISSION_ACTIONS.filter(
            (action) => !LANGY_CLASSIFIED_ACTIONS.has(action),
          ),
          "These actions exist in rbac.ts `Actions` but no Langy bucket " +
            "claims them. Put each in DELEGABLE_ACTIONS or ACTION_EXCLUSIONS",
        ).toEqual([]);
      });
    });

    // The reverse direction, which the totality checks above cannot see: a
    // family name TYPO'D or gone stale in a policy bucket is classified-but-
    // nonexistent, and the one-directional sweep stays green while the real
    // family it was meant to cover sits wherever it happened to land.
    describe("when a classified name does not exist in rbac.ts", () => {
      it("fails here, so a typo'd or removed family cannot sit in a bucket classifying nothing", async () => {
        const families = new Set(ALL_PERMISSION_FAMILIES);
        expect(
          [...LANGY_CLASSIFIED_FAMILIES].filter((f) => !families.has(f)),
        ).toEqual([]);

        const actions = new Set(ALL_PERMISSION_ACTIONS);
        expect(
          [...LANGY_CLASSIFIED_ACTIONS].filter((a) => !actions.has(a)),
        ).toEqual([]);
      });
    });

    // The classified sets are UNIONS, which would hide an overlap: a family
    // or action in two buckets is decided by `classifyForLangy`'s branch
    // order, not by anyone's intent. Disjoint iff the pre-dedup sum equals
    // the union's size.
    describe("when a name appears in more than one bucket", () => {
      it("fails here, so branch order never decides a verdict", async () => {
        expect(LANGY_FAMILY_BUCKET_TOTAL).toBe(LANGY_CLASSIFIED_FAMILIES.size);
        expect(LANGY_ACTION_BUCKET_TOTAL).toBe(LANGY_CLASSIFIED_ACTIONS.size);
      });
    });
  });

  // The owner's rule has three carve-outs, and each is asserted against the
  // RESOLVED candidate list rather than the source text of the policy. A
  // regex over `langyPermissionPolicy.ts` would have passed while the list
  // itself was wrong — that is a mistake this codebase has already made once
  // in an IAM suite, where 16/16 string assertions stayed green through an
  // added wildcard privilege.
  describe("given the boundaries the owner drew", () => {
    describe("when the permission would read a stored secret", () => {
      it("is absent from the candidate list at every grain, including view", async () => {
        expect(
          LANGY_CANDIDATE_PERMISSIONS.filter((p) => p.startsWith("secrets:")),
        ).toEqual([]);
      });
    });

    describe("when the permission would WRITE the auth scope", () => {
      it("is absent, while the corresponding read stays available", async () => {
        // Asserted against the policy's own inventory, not a hand-copied
        // family list — four hand copies of this list existed once, and a
        // family added to the policy would have missed all of them silently.
        const authScopeWrites = LANGY_CANDIDATE_PERMISSIONS.filter((p) => {
          const [family, action] = p.split(":");
          return (
            LANGY_AUTH_SCOPE_FAMILY_NAMES.includes(family!) && action !== "view"
          );
        });
        expect(authScopeWrites).toEqual([]);

        // The other half of the rule — "auth scope read is okay" — so that
        // tightening the line above cannot quietly take the reads with it.
        // Only these two demonstrate it: the other auth-scope families are
        // org-exclusive, so their reads are `unreachable` at project scope,
        // not granted (see the org-scoped-binding pin above).
        expect(LANGY_CANDIDATE_PERMISSIONS).toContain("auditLog:view");
        expect(LANGY_CANDIDATE_PERMISSIONS).toContain("project:view");
      });
    });

    describe("when the family is virtualKeys, the gateway-credential carve-out", () => {
      it("carries the write surface except the grains that reach rotation", async () => {
        // virtualKeys has full writes (owner decision, 2026-08-21) — pin it
        // so a tightening of the auth-scope list cannot quietly reclassify it.
        expect(LANGY_CANDIDATE_PERMISSIONS).toContain("virtualKeys:view");
        expect(LANGY_CANDIDATE_PERMISSIONS).toContain("virtualKeys:create");
        expect(LANGY_CANDIDATE_PERMISSIONS).toContain("virtualKeys:update");
        expect(LANGY_CANDIDATE_PERMISSIONS).toContain("virtualKeys:delete");
        // `:manage` is withheld (GRAIN_EXCLUSIONS) because the hierarchy
        // folds `:rotate` into it — the assertion below is on the EFFECTIVE
        // grain, so it goes red if anyone re-grants `:manage` and quietly
        // makes rotation reachable again.
        expect(LANGY_CANDIDATE_PERMISSIONS).not.toContain("virtualKeys:manage");
        expect(
          hasPermissionWithHierarchy(
            [...LANGY_CANDIDATE_PERMISSIONS],
            "virtualKeys:rotate",
          ),
        ).toBe(false);
      });
    });

    describe("when the action escapes the user-permission ceiling", () => {
      it("is absent, because 'the caller could have done it too' does not bound public disclosure or credential rotation", async () => {
        expect(
          LANGY_CANDIDATE_PERMISSIONS.filter((p) =>
            [":share", ":rotate", ":viewOtherPersonal"].some((suffix) =>
              p.endsWith(suffix),
            ),
          ),
        ).toEqual([]);

        // The hierarchy version of the same claim: no candidate IMPLIES an
        // excluded grain that any route actually enforces. `:manage` expands
        // to `:rotate` (rbac.ts) — a direct-containment check alone stayed
        // green while `virtualKeys:manage` made rotation fully reachable at
        // the door. Scoped to route-demanded grains because the hierarchy
        // folds `:rotate` into EVERY family's `:manage` as a string
        // (`analytics:rotate` is well-typed and enforced nowhere).
        const excludedSuffixes = [":share", ":rotate", ":viewOtherPersonal"];
        let checked = 0;
        for (const [permission] of permissionsDemandedByRoutes()) {
          if (!excludedSuffixes.some((s) => permission.endsWith(s))) continue;
          checked++;
          expect(
            hasPermissionWithHierarchy(
              [...LANGY_CANDIDATE_PERMISSIONS],
              permission,
            ),
            `${permission} is reachable through the hierarchy`,
          ).toBe(false);
        }
        // Scoping the loop to route-demanded grains bought precision at the
        // cost of a vacuity risk: rename or re-gate every such route and the
        // body runs zero times while the test stays green. Pin that it saw
        // work, so the coverage disappearing is itself a failure.
        expect(
          checked,
          "No route demands an excluded grain any more, so the hierarchy " +
            "check above ran on nothing. Re-point it or delete it.",
        ).toBeGreaterThan(0);
      });
    });

    describe("when the family is Langy itself or platform operations", () => {
      it("is absent at every grain, so a session key can never start Langy turns or touch staff ops", async () => {
        // `langy:create` gates `POST /api/langy` — a key that carries it can
        // invoke Langy recursively, and the intersection ceiling bounds
        // authority, not amplification.
        expect(
          LANGY_CANDIDATE_PERMISSIONS.filter(
            (p) => p.startsWith("langy:") || p.startsWith("ops:"),
          ),
        ).toEqual([]);
      });
    });

    describe("when the family is ordinary tenant data", () => {
      it("carries the full write surface, which is the widening this policy exists to express", async () => {
        for (const permission of [
          "datasets:delete",
          "prompts:manage",
          "scenarios:delete",
          "triggers:create",
          "workflows:manage",
          "experiments:update",
        ]) {
          expect(LANGY_CANDIDATE_PERMISSIONS).toContain(permission);
        }
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
        // The session-only execute route must NOT leak into the API-key
        // surface. This is a pin on the route's `credential` classification,
        // not on Langy's grants — Langy may hold `evaluations:manage` now, but
        // a session-only route that starts reading as key-reachable means a
        // policy was misfiled, which is the drift this test exists to catch.
        expect(reachable).not.toContain("evaluations:manage");
      });
    });
  });

  // The sweeps above cannot see THIS class of bug, and it is worth saying why.
  // Both of them filter to grains `classifyForLangy` says Langy should hold, so
  // a route demanding a COARSER grain than its action needs — `evaluations:manage`
  // to create a monitor — is discarded before it can fail anything. Widening a
  // route from `:create` to `:manage` therefore makes the guard quieter, not
  // louder. Until that blindness is fixed generally, the surfaces it already bit
  // get pinned by name.
  //
  // Monitors is the one it bit: `POST /api/monitors` demanded `evaluations:manage`
  // while the tRPC twin the UI's own create button calls asks only for
  // `evaluations:create` — and writes `enabled: true` either way. The same action
  // cost more over REST than in the product, which refused every least-privilege
  // key without holding any line the UI held.
  describe("given the monitor write routes", () => {
    describe("when the grains they demand are read out of the registry", () => {
      it("gates creating a monitor on the grain the product's own create uses", () => {
        const demanded = permissionsDemandedByRoutes();
        const monitorRoutes = (permission: string) =>
          (demanded.get(permission) ?? []).filter((route) =>
            route.includes("/api/monitors"),
          );

        expect(
          monitorRoutes("evaluations:create").some((route) =>
            route.startsWith("POST "),
          ),
          "Creating a monitor must demand evaluations:create, matching " +
            "server/api/routers/monitors.ts. Any coarser grain refuses every " +
            "least-privilege key while the UI creates the same enabled monitor",
        ).toBe(true);

        // Deletion is where the destructive line sits, and it keeps `:manage`.
        // Asserted positively as well as negatively: the exclusion below is
        // also satisfied by a monitors surface where NOTHING demands `:manage`,
        // so on its own it would go quietly green if someone widened DELETE to
        // `:create` too. That is the one change this pin exists to catch.
        expect(
          monitorRoutes("evaluations:manage").filter((route) =>
            route.startsWith("DELETE "),
          ),
          "No monitor DELETE route demands evaluations:manage. Destroying a " +
            "monitor is the destructive grain and must stay behind :manage, " +
            "which a least-privilege key holds only if its owner does",
        ).not.toEqual([]);

        expect(
          monitorRoutes("evaluations:manage").filter(
            (route) => !route.startsWith("DELETE "),
          ),
          "A non-delete monitor route demands evaluations:manage — a coarser " +
            "grain than the action needs, so this is a 403 at the door for " +
            "an action the product allows on :create",
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
