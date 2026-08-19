import { describe, expect, it } from "vitest";
import {
  attachGrantsCommandDataSchema,
  defineRolesCommandDataSchema,
  revokeGrantsCommandDataSchema,
} from "../schemas/commands";

/**
 * The wire boundary's job is to make unrepresentable grants unrepresentable.
 * Each case below is a fact that would otherwise fold cleanly and then sit in
 * the projection as something nobody can name, revoke, or explain.
 */

const ORG = "org_acme";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    grantId: "grant_1",
    principal: { type: "user", id: "user_alice" },
    roleKey: "member",
    scope: { type: "TEAM", id: "team_client_a" },
    source: "grants-service",
    actor: { type: "user", id: "user_admin" },
    occurredAtMs: 1_755_000_000_000,
    ...overrides,
  };
}

/**
 * One resource grant's full terms. The schema requires the resource's own
 * identity - what the shared thing is, and which project it lives in -
 * alongside the terms, so a fixture carrying only token and permission is
 * refused before any test here reaches the rule it is actually about.
 */
const SHARE_TERMS = {
  kind: "trace",
  projectId: "proj_chatbot",
  token: "tok_1",
  permission: "traces:view",
} as const;

function parse(overrides: Record<string, unknown> = {}, entryOverrides = {}) {
  return attachGrantsCommandDataSchema.safeParse({
    tenantId: ORG,
    organizationId: ORG,
    commandId: "cmd_1",
    grants: [entry(entryOverrides)],
    ...overrides,
  });
}

describe("the grants ledger's wire boundary", () => {
  describe("given a well-formed batch", () => {
    it("accepts it", () => {
      expect(parse().success).toBe(true);
    });

    it("accepts a resource grant with its terms and no role", () => {
      const result = parse(
        {},
        {
          principal: { type: "anyone", id: null },
          roleKey: null,
          scope: { type: "RESOURCE", id: "trace_t1" },
          resource: SHARE_TERMS,
        },
      );
      expect(result.success).toBe(true);
    });
  });

  describe("when the command names two different organizations", () => {
    it("refuses it, rather than persisting under one and folding into the other", () => {
      expect(parse({ tenantId: "org_other" }).success).toBe(false);
    });
  });

  describe("when a principal's id disagrees with its type", () => {
    it("refuses a subject-less user", () => {
      expect(parse({}, { principal: { type: "user", id: null } }).success).toBe(
        false,
      );
    });

    it("refuses an `anyone` wearing a subject's id", () => {
      expect(
        parse(
          {},
          {
            principal: { type: "anyone", id: "user_alice" },
            roleKey: null,
            scope: { type: "RESOURCE", id: "trace_t1" },
            resource: SHARE_TERMS,
          },
        ).success,
      ).toBe(false);
    });
  });

  describe("when resource terms and scope disagree", () => {
    it("refuses share terms on a team-wide grant", () => {
      expect(parse({}, { resource: SHARE_TERMS }).success).toBe(false);
    });

    it("refuses a resource grant with no terms", () => {
      expect(
        parse(
          {},
          {
            principal: { type: "anyone", id: null },
            roleKey: null,
            scope: { type: "RESOURCE", id: "trace_t1" },
          },
        ).success,
      ).toBe(false);
    });

    it("refuses a roleless grant at TEAM scope - a null role key spells absence, and only a RESOURCE grant may spell it", () => {
      expect(parse({}, { roleKey: null }).success).toBe(false);
    });

    it("refuses a resource grant that also carries a role", () => {
      expect(
        parse(
          {},
          {
            principal: { type: "anyone", id: null },
            roleKey: "member",
            scope: { type: "RESOURCE", id: "trace_t1" },
            resource: SHARE_TERMS,
          },
        ).success,
      ).toBe(false);
    });
  });

  describe("when a resource-tier principal appears at a wider scope", () => {
    it("refuses a standing public grant over a whole organization", () => {
      // `anyone` names no subject, so this grant is held by nobody and can be
      // revoked by no principal - a permanent public grant over the tenant.
      expect(
        parse(
          {},
          {
            principal: { type: "anyone", id: null },
            roleKey: "viewer",
            scope: { type: "ORGANIZATION", id: ORG },
          },
        ).success,
      ).toBe(false);
    });

    it("refuses a `project` principal outside RESOURCE scope", () => {
      expect(
        parse({}, { principal: { type: "project", id: "proj_chatbot" } })
          .success,
      ).toBe(false);
    });
  });

  describe("when a string field arrives empty", () => {
    it("refuses a grant id that names nothing", () => {
      expect(parse({}, { grantId: "" }).success).toBe(false);
    });

    it("refuses a role key that is the empty string rather than null", () => {
      expect(parse({}, { roleKey: "" }).success).toBe(false);
    });

    it("refuses a role whose permission list holds an empty entry", () => {
      expect(
        defineRolesCommandDataSchema.safeParse({
          tenantId: ORG,
          organizationId: ORG,
          commandId: "cmd_1",
          actor: { type: "user", id: "user_admin" },
          roles: [
            {
              roleId: "role_1",
              name: "Auditor",
              permissions: ["traces:read", ""],
              kind: "custom",
              occurredAtMs: 1_755_000_000_000,
            },
          ],
        }).success,
      ).toBe(false);
    });
  });
});

describe("the revocation wire boundary", () => {
  function revoke(entry: Record<string, unknown>) {
    return revokeGrantsCommandDataSchema.safeParse({
      tenantId: ORG,
      organizationId: ORG,
      commandId: "cmd_1",
      revocations: [entry],
      actor: { type: "user", id: "user_admin" },
      occurredAtMs: 1_755_000_000_000,
    });
  }

  describe("given a revocation naming a grant id", () => {
    it("accepts it", () => {
      expect(revoke({ grantId: "grant_1" }).success).toBe(true);
    });
  });

  describe("given a revocation naming an identity instead", () => {
    it("accepts a principal with no scope, meaning every scope", () => {
      expect(
        revoke({ selector: { principal: { type: "api_key", id: "key_1" } } })
          .success,
      ).toBe(true);
    });

    it("accepts a principal narrowed to one scope", () => {
      expect(
        revoke({
          selector: {
            principal: { type: "user", id: "user_alice" },
            scope: { type: "TEAM", id: "team_client_a" },
          },
        }).success,
      ).toBe(true);
    });

    it("refuses a subject-less selector, which would revoke by nothing", () => {
      expect(
        revoke({ selector: { principal: { type: "user", id: null } } }).success,
      ).toBe(false);
    });
  });

  describe("given a revocation naming neither", () => {
    it("refuses it rather than appending a fact that removes nothing", () => {
      expect(revoke({ reason: "seat removed" }).success).toBe(false);
    });
  });
});
