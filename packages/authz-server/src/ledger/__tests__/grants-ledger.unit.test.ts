import { describe, expect, it } from "vitest";
import { deriveGrantId } from "../grant-identity";
import {
  emptyGrantsLedgerState,
  reduceGrantsLedger,
  type GrantFact,
  type GrantsLedgerEvent,
  type GrantsLedgerState,
} from "../grants-ledger.reducer";

const ORG = "org_acme";
const ACTOR = { type: "user" as const, id: "user_admin" };

const OCCURRED_AT = 1_755_000_000_000;

function grantFact(overrides?: Partial<GrantFact>): GrantFact {
  const principal = overrides?.principal ?? {
    type: "user" as const,
    id: "user_alice",
  };
  const scope = overrides?.scope ?? {
    type: "TEAM" as const,
    id: "team_client_a",
  };
  return {
    grantId: deriveGrantId({
      organizationId: ORG,
      principal,
      scope,
      occurredAtMs: OCCURRED_AT,
    }),
    principal,
    scope,
    roleKey: "member",
    source: "grants-service",
    occurredAtMs: OCCURRED_AT,
    ...overrides,
  };
}

function apply(
  events: GrantsLedgerEvent[],
  from?: GrantsLedgerState,
): GrantsLedgerState {
  return events.reduce(
    (state, event) => reduceGrantsLedger({ state, event }),
    from ?? emptyGrantsLedgerState({ organizationId: ORG }),
  );
}

describe("grants ledger reducer", () => {
  describe("given an empty ledger", () => {
    describe("when a grant is attached", () => {
      const grant = grantFact();
      const state = apply([{ kind: "grant_attached", grant, actor: ACTOR }]);

      it("holds the fact under its deterministic id", () => {
        expect(state.grants[grant.grantId]).toEqual(grant);
      });

      it("applies the same event twice without changing anything", () => {
        const again = apply(
          [{ kind: "grant_attached", grant, actor: ACTOR }],
          state,
        );
        expect(again).toEqual(state);
      });

      it("leaves the input state untouched", () => {
        const before = emptyGrantsLedgerState({ organizationId: ORG });
        reduceGrantsLedger({
          state: before,
          event: { kind: "grant_attached", grant, actor: ACTOR },
        });
        expect(before.grants).toEqual({});
      });
    });

    describe("when a role change or revoke names a grant that does not exist", () => {
      it("changes nothing", () => {
        const empty = emptyGrantsLedgerState({ organizationId: ORG });
        const changed = apply([
          {
            kind: "grant_role_changed",
            grantId: "grant_missing",
            from: "member",
            to: "admin",
            actor: ACTOR,
            occurredAtMs: 1,
          },
          {
            kind: "grant_revoked",
            grantId: "grant_missing",
            actor: ACTOR,
            occurredAtMs: 2,
          },
        ]);
        expect(changed).toEqual(empty);
      });
    });
  });

  describe("given a ledger holding a grant", () => {
    const grant = grantFact();
    const attached: GrantsLedgerEvent[] = [
      { kind: "grant_attached", grant, actor: ACTOR },
    ];

    describe("when the grant's role is changed", () => {
      it("keeps the same fact id and moves only the role", () => {
        const state = apply([
          ...attached,
          {
            kind: "grant_role_changed",
            grantId: grant.grantId,
            from: "member",
            to: "viewer",
            actor: ACTOR,
            occurredAtMs: 2,
          },
        ]);
        expect(state.grants[grant.grantId]?.roleKey).toBe("viewer");
        expect(state.grants[grant.grantId]?.scope).toEqual(grant.scope);
      });
    });

    describe("when the grant is revoked", () => {
      const state = apply([
        ...attached,
        {
          kind: "grant_revoked",
          grantId: grant.grantId,
          actor: ACTOR,
          occurredAtMs: 2,
        },
      ]);

      it("removes the fact", () => {
        expect(state.grants[grant.grantId]).toBeUndefined();
      });

      it("revokes again without changing anything", () => {
        const again = apply(
          [
            {
              kind: "grant_revoked",
              grantId: grant.grantId,
              actor: ACTOR,
              occurredAtMs: 3,
            },
          ],
          state,
        );
        expect(again).toEqual(state);
      });
    });
  });

  describe("given a member holding grants at several scopes", () => {
    const team = grantFact();
    const project = grantFact({
      scope: { type: "PROJECT", id: "proj_chatbot" },
      grantId: deriveGrantId({
        organizationId: ORG,
        principal: { type: "user", id: "user_alice" },
        scope: { type: "PROJECT", id: "proj_chatbot" },
        occurredAtMs: OCCURRED_AT,
      }),
    });
    const survivor = grantFact({
      principal: { type: "user", id: "user_bob" },
      grantId: deriveGrantId({
        organizationId: ORG,
        principal: { type: "user", id: "user_bob" },
        scope: { type: "TEAM", id: "team_client_a" },
        occurredAtMs: OCCURRED_AT,
      }),
    });

    describe("when the member is offboarded", () => {
      const state = apply([
        { kind: "grant_attached", grant: team, actor: ACTOR },
        { kind: "grant_attached", grant: project, actor: ACTOR },
        { kind: "grant_attached", grant: survivor, actor: ACTOR },
        {
          kind: "member_offboarded",
          userId: "user_alice",
          revokedGrantIds: [team.grantId, project.grantId],
          actor: ACTOR,
          occurredAtMs: 9,
        },
      ]);

      it("removes every named grant in one event", () => {
        expect(state.grants[team.grantId]).toBeUndefined();
        expect(state.grants[project.grantId]).toBeUndefined();
      });

      it("leaves other principals' grants alone", () => {
        expect(state.grants[survivor.grantId]).toEqual(survivor);
      });
    });
  });

  describe("given role definitions", () => {
    const role = {
      roleId: "role_auditor",
      name: "Auditor",
      permissions: ["analytics:view", "traces:view"],
      kind: "custom" as const,
      occurredAtMs: 1,
    };

    describe("when a role is defined, edited, and deleted", () => {
      it("tracks the definition through its lifecycle", () => {
        const defined = apply([
          { kind: "role_defined", role, actor: ACTOR },
          {
            kind: "role_permissions_changed",
            roleId: role.roleId,
            permissions: ["traces:view"],
            actor: ACTOR,
            occurredAtMs: 2,
          },
        ]);
        expect(defined.roles[role.roleId]?.permissions).toEqual([
          "traces:view",
        ]);

        const deleted = apply(
          [
            {
              kind: "role_deleted",
              roleId: role.roleId,
              actor: ACTOR,
              occurredAtMs: 3,
            },
          ],
          defined,
        );
        expect(deleted.roles[role.roleId]).toBeUndefined();
      });
    });
  });

  describe("given the cutover process events", () => {
    describe("when parity is proved and the cutover completes", () => {
      const state = apply([
        { kind: "migration_parity_proved", diffs: [], occurredAtMs: 5 },
        { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 6 },
      ]);

      it("marks the organization as on the engine with its proof", () => {
        expect(state.cutover.onEngine).toBe(true);
        expect(state.cutover.provedAtMs).toBe(5);
        expect(state.cutover.parityDiffs).toEqual([]);
      });
    });

    describe("when the cutover is rolled back", () => {
      it("puts the organization back on the legacy path", () => {
        const state = apply([
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 6 },
          { kind: "cutover_rolled_back", actor: ACTOR, occurredAtMs: 7 },
        ]);
        expect(state.cutover.onEngine).toBe(false);
      });
    });
  });

  describe("given the same event stream applied twice", () => {
    it("folds to deep-equal states", () => {
      const grant = grantFact();
      const stream: GrantsLedgerEvent[] = [
        { kind: "grant_attached", grant, actor: ACTOR },
        {
          kind: "grant_role_changed",
          grantId: grant.grantId,
          from: "member",
          to: "admin",
          actor: ACTOR,
          occurredAtMs: 2,
        },
        { kind: "migration_parity_proved", diffs: [], occurredAtMs: 3 },
        { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 4 },
      ];
      expect(apply(stream)).toEqual(apply(stream));
    });
  });
});

describe("grant identity", () => {
  const base = {
    organizationId: ORG,
    principal: { type: "user" as const, id: "user_alice" },
    scope: { type: "TEAM" as const, id: "team_client_a" },
    occurredAtMs: OCCURRED_AT,
  };

  describe("when the same fact is derived twice", () => {
    it("yields the same id — a KSUID with no random bits", () => {
      const a = deriveGrantId(base);
      const b = deriveGrantId({ ...base });
      expect(a).toBe(b);
      expect(a).toContain("grant_");
    });
  });

  describe("when any part of the fact differs", () => {
    it("yields a different id per scope, principal, org, token, and business time", () => {
      const ids = [
        deriveGrantId(base),
        deriveGrantId({ ...base, organizationId: "org_other" }),
        deriveGrantId({
          ...base,
          principal: { type: "api_key", id: "user_alice" },
        }),
        deriveGrantId({
          ...base,
          scope: { type: "PROJECT", id: "team_client_a" },
        }),
        deriveGrantId({ ...base, resourceToken: "tok_1" }),
        deriveGrantId({ ...base, resourceToken: "tok_2" }),
        deriveGrantId({ ...base, occurredAtMs: OCCURRED_AT + 60_000 }),
      ];
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("ignores sub-second differences in business time", () => {
      // KSUID timestamps are second-precision; a retry landing in the same
      // second as the original command derives the same id.
      expect(deriveGrantId({ ...base, occurredAtMs: OCCURRED_AT + 500 })).toBe(
        deriveGrantId(base),
      );
    });
  });
});
