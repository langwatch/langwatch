import { describe, expect, it } from "vitest";
import type { GrantFact } from "../grants-ledger.reducer";
import {
  grantFactToCompatBinding,
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

describe("grant row mapping", () => {
  describe("when a fact round-trips through the row shape", () => {
    it("comes back identical, resource terms included", () => {
      const withResource = fact({
        principal: { type: "anyone", id: null },
        roleKey: null,
        scope: { type: "RESOURCE", id: "trace_t1" },
        resource: {
          token: "tok_1",
          permission: "traces:view",
          expiresAtMs: 1_756_000_000_000,
          maxViews: 5,
        },
      });
      for (const original of [fact(), withResource]) {
        const row = grantFactToRow({ grant: original, organizationId: ORG });
        expect(row.organizationId).toBe(ORG);
        expect(grantRowToFact(row)).toEqual(original);
      }
    });

    it("uppercases the principal type for the table and lowers it back", () => {
      const row = grantFactToRow({
        grant: fact({ principal: { type: "api_key", id: "key_1" } }),
        organizationId: ORG,
      });
      expect(row.principalType).toBe("API_KEY");
      expect(grantRowToFact(row).principal.type).toBe("api_key");
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

    it("sets exactly one principal column per principal type", () => {
      const group = grantFactToCompatBinding({
        grant: fact({ principal: { type: "group", id: "grp_1" } }),
        organizationId: ORG,
      });
      expect(group?.groupId).toBe("grp_1");
      expect(group?.userId).toBeNull();
      expect(group?.apiKeyId).toBeNull();
      const key = grantFactToCompatBinding({
        grant: fact({ principal: { type: "api_key", id: "key_1" } }),
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
