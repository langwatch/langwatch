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

  describe("given a resource-tier grant carrying its share terms", () => {
    const share = grantFact({
      principal: { type: "anyone", id: null },
      roleKey: null,
      scope: { type: "RESOURCE", id: "trace_t1" },
      resource: {
        kind: "trace",
        projectId: "proj_chatbot",
        token: "tok_1",
        permission: "traces:view",
        createdByUserId: "user_alice",
      },
      source: "cutover-import",
      grantId: deriveGrantId({
        organizationId: ORG,
        principal: { type: "anyone", id: null },
        scope: { type: "RESOURCE", id: "trace_t1" },
        resourceToken: "tok_1",
        occurredAtMs: OCCURRED_AT,
      }),
    });

    describe("when it is attached and later revoked", () => {
      it("folds and departs like any other fact, terms intact", () => {
        const attached = apply([
          { kind: "grant_attached", grant: share, actor: ACTOR },
        ]);
        expect(attached.grants[share.grantId]).toEqual(share);
        expect(attached.grants[share.grantId]?.resource?.projectId).toBe(
          "proj_chatbot",
        );

        const revoked = apply(
          [
            {
              kind: "grant_revoked",
              grantId: share.grantId,
              actor: ACTOR,
              occurredAtMs: OCCURRED_AT + 1_000,
            },
          ],
          attached,
        );
        expect(revoked.grants[share.grantId]).toBeUndefined();
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

    describe("when an adopted binding's role is reassigned", () => {
      /** @scenario "A role change clears the pre-migration legacy role" */
      it("drops the imported legacyRole rather than carrying it onto the new role", () => {
        const imported = grantFact({
          roleKey: "custom:cr_ops",
          legacyRole: "ADMIN",
        });
        const state = apply([
          { kind: "grant_attached", grant: imported, actor: ACTOR },
          {
            kind: "grant_role_changed",
            grantId: imported.grantId,
            from: "custom:cr_ops",
            to: "custom:cr_sre",
            actor: ACTOR,
            occurredAtMs: 2,
          },
        ]);
        expect(state.grants[imported.grantId]?.roleKey).toBe("custom:cr_sre");
        expect(state.grants[imported.grantId]).not.toHaveProperty(
          "legacyRole",
        );
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

    describe("when the offboarding names only the grants the projection had seen", () => {
      /** The writer resolves `revokedGrantIds` from the compat projection,
       *  which lags a fold behind the ledger. */
      const unseen = grantFact({
        scope: { type: "PROJECT", id: "proj_late" },
        grantId: "grant_appended_but_not_yet_folded",
      });

      it("sweeps the grant the id list never mentioned", () => {
        const state = apply([
          { kind: "grant_attached", grant: team, actor: ACTOR },
          { kind: "grant_attached", grant: unseen, actor: ACTOR },
          { kind: "grant_attached", grant: survivor, actor: ACTOR },
          {
            kind: "member_offboarded",
            userId: "user_alice",
            revokedGrantIds: [team.grantId],
            actor: ACTOR,
            occurredAtMs: 9,
          },
        ]);

        expect(state.grants[unseen.grantId]).toBeUndefined();
        expect(state.grants[team.grantId]).toBeUndefined();
        expect(state.grants[survivor.grantId]).toEqual(survivor);
      });

      it("folds to the same state on a replay of the stream", () => {
        const stream: GrantsLedgerEvent[] = [
          { kind: "grant_attached", grant: team, actor: ACTOR },
          { kind: "grant_attached", grant: unseen, actor: ACTOR },
          {
            kind: "member_offboarded",
            userId: "user_alice",
            revokedGrantIds: [team.grantId],
            actor: ACTOR,
            occurredAtMs: 9,
          },
        ];
        const firstFold = apply(stream);
        const replayFold = apply(stream);

        expect(replayFold).toEqual(firstFold);
      });

      it("keeps a grant attached after the offboarding, which is a re-onboarding", () => {
        const rehired = grantFact({ grantId: "grant_rehired" });
        const state = apply([
          { kind: "grant_attached", grant: team, actor: ACTOR },
          {
            kind: "member_offboarded",
            userId: "user_alice",
            revokedGrantIds: [team.grantId],
            actor: ACTOR,
            occurredAtMs: 9,
          },
          { kind: "grant_attached", grant: rehired, actor: ACTOR },
        ]);

        expect(state.grants[rehired.grantId]).toEqual(rehired);
      });
    });
  });

  describe("given a revocation that named an identity rather than ids", () => {
    const seen = grantFact({ grantId: "grant_seen" });
    const unseen = grantFact({ grantId: "grant_unseen" });
    const otherScope = grantFact({
      grantId: "grant_other_scope",
      scope: { type: "PROJECT", id: "proj_chatbot" },
    });
    const otherPrincipal = grantFact({
      grantId: "grant_other_principal",
      principal: { type: "user", id: "user_bob" },
    });

    const attached: GrantsLedgerEvent[] = [
      { kind: "grant_attached", grant: seen, actor: ACTOR },
      { kind: "grant_attached", grant: unseen, actor: ACTOR },
      { kind: "grant_attached", grant: otherScope, actor: ACTOR },
      { kind: "grant_attached", grant: otherPrincipal, actor: ACTOR },
    ];

    describe("when the selector names a principal at one scope", () => {
      const state = apply([
        ...attached,
        {
          kind: "grant_revoked",
          grantId: seen.grantId,
          selector: {
            principal: { type: "user", id: "user_alice" },
            scope: { type: "TEAM", id: "team_client_a" },
          },
          actor: ACTOR,
          occurredAtMs: 9,
        },
      ]);

      it("removes the grant the lagging projection never listed", () => {
        expect(state.grants[unseen.grantId]).toBeUndefined();
        expect(state.grants[seen.grantId]).toBeUndefined();
      });

      it("leaves the same principal's other scopes and other principals alone", () => {
        expect(state.grants[otherScope.grantId]).toEqual(otherScope);
        expect(state.grants[otherPrincipal.grantId]).toEqual(otherPrincipal);
      });
    });

    describe("when the selector names a principal at every scope", () => {
      it("removes every grant that principal holds", () => {
        const state = apply([
          ...attached,
          {
            kind: "grant_revoked",
            selector: { principal: { type: "user", id: "user_alice" } },
            actor: ACTOR,
            occurredAtMs: 9,
          },
        ]);

        expect(state.grants[seen.grantId]).toBeUndefined();
        expect(state.grants[unseen.grantId]).toBeUndefined();
        expect(state.grants[otherScope.grantId]).toBeUndefined();
        expect(state.grants[otherPrincipal.grantId]).toEqual(otherPrincipal);
      });
    });

    describe("when the revocation carries no selector", () => {
      it("removes the named id alone, as it always did", () => {
        const state = apply([
          ...attached,
          {
            kind: "grant_revoked",
            grantId: seen.grantId,
            actor: ACTOR,
            occurredAtMs: 9,
          },
        ]);

        expect(state.grants[seen.grantId]).toBeUndefined();
        expect(state.grants[unseen.grantId]).toEqual(unseen);
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
