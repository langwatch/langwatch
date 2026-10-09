/**
 * The door's aggregate-project rules (ADR-177 decisions 5 and 8) and the proof it mints.
 *
 * Spec: specs/governance/aggregate-project.feature.
 */
import { type PermissionDecision, sealAuthorization } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { authorizeDefaults } from "../../__tests__/api-double.ts";
import {
  decide,
  declaredPermissions,
  mintAuthorization,
  refuseWriteUnderAggregate,
  scopeWithOrganization,
  type Authorize,
  type Caller,
} from "../access.ts";

const sam: Caller = { actor: { type: "user", id: "user_sam" } };
const PROOF = sealAuthorization({
  actor: { type: "user", id: "user_sam" },
  principal: { type: "user", id: "user_sam" },
  scope: { organizationId: "org_acme" },
  grants: [{ projectId: "proj_aggregate", permissions: ["traces:view"], via: [], kind: "own" }],
  expiresAt: 1_760_000_300_000,
  purpose: { kind: "route", route: "traces.getAllForProject" },
});
const readOnly = expect.objectContaining({ code: "aggregate_project_is_read_only" });

function door({
  role,
  kind,
}: {
  role: PermissionDecision["organizationRole"];
  kind: string;
}): Authorize & { minted: unknown[]; kindReads: string[] } {
  const minted: unknown[] = [];
  const kindReads: string[] = [];
  const decision: PermissionDecision = { permitted: true, organizationRole: role };

  return {
    ...authorizeDefaults,
    minted,
    kindReads,
    getDecision: async () => decision,
    getProjectAnyDecision: async () => decision,
    checkScopeLineage: async () => ({ kind: "consistent" }),
    organizationOf: async () => "org_acme",
    projectKindOf: async (projectId) => {
      kindReads.push(projectId);
      return kind;
    },
    authorization: async (input) => {
      minted.push(input);
      return PROOF;
    },
  };
}

describe("opening an aggregate project at the door", () => {
  describe("given a member on the aggregate's team who is not an admin", () => {
    /** @scenario "A non-admin on the aggregate's team is refused" */
    it("refuses the request as if no grant reached the project", async () => {
      const refusal = decide({
        declaration: { kind: "permission", permission: "traces:view" },
        caller: sam,
        input: { projectId: "proj_aggregate" },
        authorize: door({ role: "MEMBER", kind: "aggregate" }),
      });

      await expect(refusal).rejects.toMatchObject({
        code: "permission_denied",
        denialReason: "no-grant",
      });
    });

    it("admits the same member on an ordinary project", async () => {
      const decision = await decide({
        declaration: { kind: "permission-any", permissions: ["traces:view", "analytics:view"] },
        caller: sam,
        input: { projectId: "proj_app" },
        authorize: door({ role: "MEMBER", kind: "application" }),
      });

      expect(decision.scope).toEqual({ tier: "project", id: "proj_app" });
    });
  });

  describe("given an organisation admin", () => {
    /** @scenario "An organisation admin opens the aggregate project" */
    it("admits the admin without reading the project's kind", async () => {
      const authorize = door({ role: "ADMIN", kind: "aggregate" });

      await decide({
        declaration: { kind: "permission", permission: "traces:view" },
        caller: sam,
        input: { projectId: "proj_aggregate" },
        authorize,
      });

      expect(authorize.kindReads).toEqual([]);
    });

    it("hands the handler a scope that carries the project's kind", async () => {
      const scope = await scopeWithOrganization({
        scope: { tier: "project", id: "proj_aggregate" },
        authorize: door({ role: "ADMIN", kind: "aggregate" }),
      });

      expect(scope).toEqual({
        tier: "project",
        id: "proj_aggregate",
        organizationId: "org_acme",
        kind: "aggregate",
      });
    });
  });
});

describe("writing under an aggregate project", () => {
  const aggregate = {
    tier: "project",
    id: "proj_aggregate",
    organizationId: "org_acme",
    kind: "aggregate",
  } as const;

  /** @scenario "Every write under the aggregate's tenant is refused on the server" */
  it("refuses a mutation under a write permission as read only", () => {
    expect(() =>
      refuseWriteUnderAggregate({
        permissions: declaredPermissions({ kind: "permission", permission: "datasets:create" }),
        scope: aggregate,
      }),
    ).toThrow(readOnly);
  });

  it("leaves views and project management open on the aggregate", () => {
    expect(() =>
      refuseWriteUnderAggregate({
        permissions: ["traces:view", "project:update"],
        scope: aggregate,
      }),
    ).not.toThrow();
  });

  it("leaves the same write open on a member project", () => {
    expect(() =>
      refuseWriteUnderAggregate({
        permissions: ["datasets:create"],
        scope: { ...aggregate, id: "proj_member", kind: "application" },
      }),
    ).not.toThrow();
  });

  it("refuses an any-of declaration on the aggregate when any of its permissions writes", () => {
    expect(() =>
      refuseWriteUnderAggregate({
        permissions: declaredPermissions({
          kind: "permission-any",
          permissions: ["traces:view", "datasets:create"],
        }),
        scope: aggregate,
      }),
    ).toThrow(readOnly);
  });

  it("leaves an any-of declaration open on the aggregate when every permission reads", () => {
    expect(() =>
      refuseWriteUnderAggregate({
        permissions: declaredPermissions({
          kind: "permission-any",
          permissions: ["traces:view", "datasets:view"],
        }),
        scope: aggregate,
      }),
    ).not.toThrow();
  });
});

describe("minting the route's proof", () => {
  /** @scenario "Opening an aggregate mints one proof listing own and shared grants" */
  it("asks authz once for a proof-bearing read on a project", async () => {
    const authorize = door({ role: "ADMIN", kind: "aggregate" });

    const authorization = await mintAuthorization({
      permission: "traces:view",
      actor: sam.actor,
      scope: { tier: "project", id: "proj_aggregate" },
      authorize,
      route: "traces.getAllForProject",
    });

    expect(authorization).toBe(PROOF);
    expect(authorize.minted).toEqual([
      {
        actor: sam.actor,
        permission: "traces:view",
        projectId: "proj_aggregate",
        purpose: { kind: "route", route: "traces.getAllForProject" },
      },
    ]);
  });

  it("mints nothing for a permission no read applies a proof under", async () => {
    const authorize = door({ role: "ADMIN", kind: "application" });

    const authorization = await mintAuthorization({
      permission: "datasets:view",
      actor: sam.actor,
      scope: { tier: "project", id: "proj_app" },
      authorize,
      route: "dataset.list",
    });

    expect(authorization).toBeNull();
    expect(authorize.minted).toEqual([]);
  });

  it("refuses a proof-bearing read it cannot mint for at a team scope", async () => {
    const minting = mintAuthorization({
      permission: "traces:view",
      actor: sam.actor,
      scope: { tier: "team", id: "team_1" },
      authorize: door({ role: "ADMIN", kind: "application" }),
      route: "traces.team",
    });

    await expect(minting).rejects.toMatchObject({ code: "permission_denied", httpStatus: 403 });
  });
});
