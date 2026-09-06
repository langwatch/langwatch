import { GRANT_EVENT_SOURCES } from "@langwatch/authz-server";
import { describe, expect, it } from "vitest";
import {
  attachGrantCommandDataSchema,
  defineRoleCommandDataSchema,
  revokeGrantCommandDataSchema,
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
  return attachGrantCommandDataSchema.safeParse({
    tenantId: ORG,
    organizationId: ORG,
    commandId: "cmd_1",
    grant: entry(entryOverrides),
    ...overrides,
  });
}

describe("the grants ledger's wire boundary", () => {
  describe("given a well-formed grant", () => {
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

  describe("when resource terms cannot say what they open", () => {
    function resourceGrant(resource: Record<string, unknown>) {
      return parse(
        {},
        {
          principal: { type: "anyone", id: null },
          roleKey: null,
          scope: { type: "RESOURCE", id: "trace_t1" },
          resource,
        },
      );
    }

    it("refuses terms that name no kind", () => {
      const { kind: _kind, ...withoutKind } = SHARE_TERMS;
      expect(resourceGrant(withoutKind).success).toBe(false);
    });

    it("refuses a kind outside the stored vocabulary", () => {
      expect(resourceGrant({ ...SHARE_TERMS, kind: "dataset" }).success).toBe(
        false,
      );
    });

    it("refuses terms that name no project", () => {
      const { projectId: _projectId, ...withoutProject } = SHARE_TERMS;
      expect(resourceGrant(withoutProject).success).toBe(false);
    });

    it("refuses an empty token, project or permission", () => {
      for (const empty of [
        { token: "" },
        { projectId: "" },
        { permission: "" },
      ]) {
        expect(resourceGrant({ ...SHARE_TERMS, ...empty }).success).toBe(false);
      }
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

    it("refuses a `project` principal at TEAM scope", () => {
      expect(
        parse({}, { principal: { type: "project", id: "proj_chatbot" } })
          .success,
      ).toBe(false);
    });

    it("refuses a `project` principal on a FOREIGN project", () => {
      // A project principal on someone else's project would be a standing
      // cross-project credential nobody holds. Only the self-grant is legal.
      expect(
        parse(
          {},
          {
            principal: { type: "project", id: "proj_chatbot" },
            roleKey: "admin",
            scope: { type: "PROJECT", id: "proj_agents" },
          },
        ).success,
      ).toBe(false);
    });

    it("accepts the project-credential self-grant", () => {
      // The one non-RESOURCE placement a project principal has: its own
      // project's scope - `Project.apiKey` acting as the project it belongs
      // to, imported by the cutover and dormant until the contract PR's edge
      // identity resolves credentials through it.
      expect(
        parse(
          {},
          {
            principal: { type: "project", id: "proj_chatbot" },
            roleKey: "admin",
            scope: { type: "PROJECT", id: "proj_chatbot" },
            source: "migration",
          },
        ).success,
      ).toBe(true);
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
        defineRoleCommandDataSchema.safeParse({
          tenantId: ORG,
          organizationId: ORG,
          commandId: "cmd_1",
          actor: { type: "user", id: "user_admin" },
          role: {
            roleId: "role_1",
            name: "Auditor",
            permissions: ["traces:read", ""],
            kind: "custom",
            occurredAtMs: 1_755_000_000_000,
          },
        }).success,
      ).toBe(false);
    });
  });

  describe("when the grant names where it came from", () => {
    /** The wire derives its enum from `GRANT_EVENT_SOURCES` rather than
     *  restating it, so adding a source to the vocabulary is the whole
     *  change. Driving the vocabulary itself is what pins that: a restated
     *  union would pass for the sources it copied and fail for the new one.
     *  @scenario "The wire accepts every source the vocabulary names" */
    it("accepts every source the vocabulary names", () => {
      for (const source of GRANT_EVENT_SOURCES) {
        expect(parse({}, { source }).success).toBe(true);
      }
    });

    it("refuses a source the vocabulary does not name", () => {
      expect(parse({}, { source: "a-surface-nobody-declared" }).success).toBe(
        false,
      );
    });
  });
});

describe("the revocation wire boundary", () => {
  function revoke(entry: Record<string, unknown>) {
    return revokeGrantCommandDataSchema.safeParse({
      tenantId: ORG,
      organizationId: ORG,
      commandId: "cmd_1",
      actor: { type: "user", id: "user_admin" },
      occurredAtMs: 1_755_000_000_000,
      ...entry,
    });
  }

  describe("given a revocation naming a grant id", () => {
    it("accepts it", () => {
      expect(revoke({ grantId: "grant_1" }).success).toBe(true);
    });
  });

  describe("given a revocation naming no grant", () => {
    /**
     * A revoke used to be able to name an IDENTITY instead of an id, and the
     * fold swept every grant matching it. The aggregate is the grant now, so
     * an event cannot address a set of them: resolving "every grant this
     * principal holds" into ids is the caller's job, and the synchronous deny
     * is what makes that safe.
     */
    it("refuses it rather than appending a fact that removes nothing", () => {
      expect(revoke({ reason: "seat removed" }).success).toBe(false);
    });

    it("refuses an empty grant id", () => {
      expect(revoke({ grantId: "" }).success).toBe(false);
    });
  });
});
