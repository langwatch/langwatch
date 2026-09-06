import { describe, expect, it } from "vitest";
import {
  type GrantFact,
} from "../facts";
import {
  grantFactToCompatBinding,
  grantFactToCompatShareLink,
  grantFactToRow,
  grantRowToFact,
  roleFactToRow,
  roleRowToFact,
} from "../projection-mapping";

const ORG = "org_acme";

function fact(overrides?: Partial<GrantFact>): GrantFact {
  return {
    grantId: "grant_abc",
    principal: { type: "user", id: "user_alice" },
    roleKey: "member",
    scope: { type: "TEAM", id: "team_client_a" },
    source: "grants-service",
    occurredAtMs: 1_755_000_000_000,
    ...overrides,
  };
}

function resourceFact(overrides?: Partial<GrantFact>): GrantFact {
  return fact({
    grantId: "grant_share_1",
    principal: { type: "anyone", id: null },
    roleKey: null,
    scope: { type: "RESOURCE", id: "trace_t1" },
    resource: {
      kind: "trace",
      projectId: "proj_chatbot",
      token: "tok_1",
      permission: "traces:view",
      createdByUserId: "user_alice",
      expiresAtMs: 1_756_000_000_000,
      maxViews: 5,
    },
    ...overrides,
  });
}

describe("grant row mapping", () => {
  describe("when a fact round-trips through the row shape", () => {
    it("comes back identical, resource terms included", () => {
      const authorless = resourceFact({
        resource: {
          kind: "thread",
          projectId: "proj_chatbot",
          token: "tok_2",
          permission: "traces:view",
        },
      });
      for (const original of [fact(), resourceFact(), authorless]) {
        const row = grantFactToRow({ grant: original, organizationId: ORG });
        expect(row.organizationId).toBe(ORG);
        expect(grantRowToFact(row)).toEqual(original);
      }
    });

    it("stores the resource identity in the table's own spelling", () => {
      const row = grantFactToRow({
        grant: resourceFact(),
        organizationId: ORG,
      });
      expect(row.resourceKind).toBe("TRACE");
      expect(row.projectId).toBe("proj_chatbot");
      expect(row.createdByUserId).toBe("user_alice");
      expect(grantRowToFact(row).resource?.kind).toBe("trace");
    });

    it("leaves the resource columns null on every other tier", () => {
      const row = grantFactToRow({ grant: fact(), organizationId: ORG });
      expect(row.resourceKind).toBeNull();
      expect(row.projectId).toBeNull();
      expect(row.createdByUserId).toBeNull();
      expect(grantRowToFact(row).resource).toBeUndefined();
    });

    it("keeps an imported binding's legacy role, so a reload is not lossy", () => {
      // load() rebuilds the fold state from these rows. A column the row
      // shape cannot carry is a fact the projection silently forgets, and
      // the next store() would then write a compat row the legacy resolver
      // reads differently.
      const imported = fact({
        roleKey: "custom:cr_ops",
        legacyRole: "ADMIN",
      });
      const row = grantFactToRow({ grant: imported, organizationId: ORG });
      expect(row.legacyRole).toBe("ADMIN");
      expect(grantRowToFact(row)).toEqual(imported);
      // Ledger-born grants have no legacy row to preserve.
      expect(
        grantFactToRow({ grant: fact(), organizationId: ORG }).legacyRole,
      ).toBeNull();
    });

    it("uppercases the principal type for the table and lowers it back", () => {
      const row = grantFactToRow({
        grant: fact({ principal: { type: "apiKey", id: "key_1" } }),
        organizationId: ORG,
      });
      expect(row.principalType).toBe("API_KEY");
      expect(grantRowToFact(row).principal.type).toBe("apiKey");
    });
  });
});

describe("role row mapping", () => {
  it("round-trips through the row shape", () => {
    const role = {
      roleId: "role_auditor",
      name: "Auditor",
      description: "read-only reviews",
      permissions: ["analytics:view"],
      kind: "custom" as const,
      occurredAtMs: 1_755_000_000_000,
    };
    const row = roleFactToRow({ role, organizationId: ORG });
    expect(roleRowToFact(row)).toEqual(role);
  });
});

describe("compat binding mapping", () => {
  describe("when the grant is expressible in the legacy tables", () => {
    it("maps built-in role keys onto TeamUserRole with no custom role", () => {
      for (const [roleKey, role] of [
        ["admin", "ADMIN"],
        ["member", "MEMBER"],
        ["viewer", "VIEWER"],
      ] as const) {
        const row = grantFactToCompatBinding({
          grant: fact({ roleKey }),
          organizationId: ORG,
        });
        expect(row?.role).toBe(role);
        expect(row?.customRoleId).toBeNull();
      }
    });

    it("carries the grant id as the binding id, so compat rows are ledger-recognisable", () => {
      const row = grantFactToCompatBinding({
        grant: fact(),
        organizationId: ORG,
      });
      expect(row?.id).toBe("grant_abc");
      expect(row?.userId).toBe("user_alice");
      expect(row?.scopeType).toBe("TEAM");
    });

    it("splits custom role keys into CUSTOM plus the role id", () => {
      const row = grantFactToCompatBinding({
        grant: fact({ roleKey: "custom:role_sre" }),
        organizationId: ORG,
      });
      expect(row?.role).toBe("CUSTOM");
      expect(row?.customRoleId).toBe("role_sre");
    });


    it("writes an imported custom binding's own role, not CUSTOM", () => {
      // The legacy resolver falls back to this column whenever the custom
      // role's permission list is empty (matchers.ts). CUSTOM resolves to
      // viewer there, so normalizing an imported ADMIN row would demote the
      // principal the moment the custom role listed nothing.
      const row = grantFactToCompatBinding({
        grant: fact({ roleKey: "custom:role_sre", legacyRole: "ADMIN" }),
        organizationId: ORG,
      });
      expect(row?.role).toBe("ADMIN");
      expect(row?.customRoleId).toBe("role_sre");
    });

    it("sets exactly one principal column per principal type", () => {
      const group = grantFactToCompatBinding({
        grant: fact({ principal: { type: "group", id: "grp_1" } }),
        organizationId: ORG,
      });
      expect(group?.groupId).toBe("grp_1");
      expect(group?.userId).toBeNull();
      expect(group?.apiKeyId).toBeNull();
      const key = grantFactToCompatBinding({
        grant: fact({ principal: { type: "apiKey", id: "key_1" } }),
        organizationId: ORG,
      });
      expect(key?.apiKeyId).toBe("key_1");
      expect(key?.groupId).toBeNull();
      expect(key?.userId).toBeNull();
      // The default fixture is a user grant - the third case, and the one
      // that proves "exactly one" rather than "at least the expected one".
      const user = grantFactToCompatBinding({
        grant: fact(),
        organizationId: ORG,
      });
      expect(user?.userId).toBe("user_alice");
      expect(user?.groupId).toBeNull();
      expect(user?.apiKeyId).toBeNull();
    });
  });

  describe("when the grant is beyond the legacy tables' vocabulary", () => {
    it("returns null for resource and platform scopes, collectives, and lite-member", () => {
      const beyond: Array<Partial<GrantFact>> = [
        {
          scope: { type: "RESOURCE", id: "trace_t1" },
          principal: { type: "anyone", id: null },
          roleKey: null,
        },
        { scope: { type: "PLATFORM", id: "platform" } },
        { principal: { type: "organization", id: ORG } },
        { principal: { type: "team", id: "team_client_a" } },
        { roleKey: "lite-member" },
      ];
      for (const overrides of beyond) {
        expect(
          grantFactToCompatBinding({
            grant: fact(overrides),
            organizationId: ORG,
          }),
        ).toBeNull();
      }
    });
  });
});

describe("compat share link mapping", () => {
  describe("when the grant is a resource fact", () => {
    it("lands the whole link row, keyed by the grant id", () => {
      const row = grantFactToCompatShareLink({
        grant: resourceFact(),
        organizationId: ORG,
      });
      expect(row).toEqual({
        id: "grant_share_1",
        token: "tok_1",
        resourceType: "TRACE",
        resourceId: "trace_t1",
        projectId: "proj_chatbot",
        userId: "user_alice",
        visibility: "PUBLIC",
        expiresAt: new Date(1_756_000_000_000),
        maxViews: 5,
      });
    });

    it("keeps view accounting out of the shape entirely", () => {
      const row = grantFactToCompatShareLink({
        grant: resourceFact(),
        organizationId: ORG,
      });
      // Not "viewCount is 0" - the key is absent, so neither the create nor
      // the update the repository derives from this row can reset a share
      // link's view budget (delivery-plan decision 22).
      expect(Object.keys(row ?? {})).not.toContain("viewCount");
    });

    it("maps each audience principal onto the stored visibility", () => {
      for (const [principal, visibility] of [
        [{ type: "anyone", id: null }, "PUBLIC"],
        [{ type: "organization", id: ORG }, "ORGANIZATION"],
        [{ type: "project", id: "proj_chatbot" }, "PROJECT"],
      ] as const) {
        const row = grantFactToCompatShareLink({
          grant: resourceFact({ principal }),
          organizationId: ORG,
        });
        expect(row?.visibility).toBe(visibility);
      }
    });

    it("carries the thread kind through in the stored spelling", () => {
      const row = grantFactToCompatShareLink({
        grant: resourceFact({
          resource: {
            kind: "thread",
            projectId: "proj_chatbot",
            token: "tok_thread",
            permission: "traces:view",
          },
        }),
        organizationId: ORG,
      });
      expect(row?.resourceType).toBe("THREAD");
      expect(row?.userId).toBeNull();
      expect(row?.expiresAt).toBeNull();
      expect(row?.maxViews).toBeNull();
    });
  });

  describe("when the grant is not a share link the legacy table can hold", () => {
    it("returns null for other scopes, other principals, and missing terms", () => {
      const beyond: Array<Partial<GrantFact>> = [
        // Not the resource tier at all.
        { scope: { type: "TEAM", id: "team_client_a" } },
        { scope: { type: "PLATFORM", id: "platform" } },
        // A principal ShareVisibility cannot express.
        { principal: { type: "user", id: "user_alice" } },
        { principal: { type: "group", id: "grp_1" } },
        { principal: { type: "team", id: "team_client_a" } },
      ];
      for (const overrides of beyond) {
        expect(
          grantFactToCompatShareLink({
            grant: resourceFact(overrides),
            organizationId: ORG,
          }),
        ).toBeNull();
      }
    });

    it("skips a resource fact carrying no terms, since it has no token", () => {
      const termless = fact({
        principal: { type: "anyone", id: null },
        roleKey: null,
        scope: { type: "RESOURCE", id: "trace_t1" },
      });
      expect(
        grantFactToCompatShareLink({ grant: termless, organizationId: ORG }),
      ).toBeNull();
    });
  });
});
