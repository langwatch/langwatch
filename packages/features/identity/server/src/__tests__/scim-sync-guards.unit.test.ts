import {
  emptyScimSync,
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_RECOVERED_EVENT_TYPE,
  SCIM_APPLY_RETIRED_EVENT_TYPE,
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  SCIM_TOKEN_REVOKED_EVENT_TYPE,
  SCIM_USER_PUSHED_EVENT_TYPE,
  type ScimSyncState,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";
import { SCIM_APPLY_MAX_ATTEMPTS, ScimSyncGuards } from "../scim-sync-guards";

const CONNECTION = "conn_okta_primary";
const ORGANIZATION = "org_acme";
const SYNC = CONNECTION;
const T0 = 1_690_000_000_000;

const commandIdentity = {
  tenantId: ORGANIZATION,
  organizationId: ORGANIZATION,
  scimSyncId: SYNC,
  connectionId: CONNECTION,
  commandId: "scimcmd_1",
  occurredAtMs: T0,
  actor: { type: "system" as const, id: "system:scim" },
};

function guardsOver(state: ScimSyncState | null) {
  return new ScimSyncGuards({
    syncs: { findSync: async () => state },
  });
}

function syncing(overrides: Partial<ScimSyncState> = {}): ScimSyncState {
  return {
    ...emptyScimSync({ scimSyncId: SYNC }),
    connectionId: CONNECTION,
    organizationId: ORGANIZATION,
    state: "SYNCING",
    ...overrides,
  };
}

describe("ScimSyncGuards", () => {
  describe("when a token is minted", () => {
    describe("given the connection has no sync yet", () => {
      it("states that the sync began", async () => {
        const facts = await guardsOver(null).issueScimToken({
          ...commandIdentity,
          tokenId: "tok_1",
        });

        expect(facts).toHaveLength(1);
        expect(facts[0]?.type).toBe(SCIM_TOKEN_ISSUED_EVENT_TYPE);
      });
    });

    describe("given the connection is already syncing", () => {
      it("states nothing, because the sync it would announce already exists", async () => {
        const facts = await guardsOver(syncing()).issueScimToken({
          ...commandIdentity,
          tokenId: "tok_2",
        });

        expect(facts).toEqual([]);
      });
    });
  });

  describe("when a push lands", () => {
    describe("given the sync was healthy", () => {
      it("states the push and nothing else", async () => {
        const facts = await guardsOver(syncing()).recordScimUserPush({
          ...commandIdentity,
          userId: "user_sam",
          externalId: "u-1",
          op: "create",
        });

        expect(facts.map((fact) => fact.type)).toEqual([
          SCIM_USER_PUSHED_EVENT_TYPE,
        ]);
      });
    });

    describe("given the sync was in ERROR", () => {
      /** @scenario A retryable failure backs off and recovers on its own */
      it("states the recovery beside the push, so it is visible where the failure was", async () => {
        const state = syncing({
          state: "ERROR",
          lastFailure: {
            op: "deactivate_user",
            errorCode: "offboard_incomplete",
            attempts: 2,
            retiredAtMs: null,
            userId: "user_sam",
            occurredAtMs: T0 - 1,
          },
        });

        const facts = await guardsOver(state).recordScimUserPush({
          ...commandIdentity,
          userId: "user_sam",
          externalId: "u-1",
          op: "update",
        });

        expect(facts.map((fact) => fact.type)).toEqual([
          SCIM_USER_PUSHED_EVENT_TYPE,
          SCIM_APPLY_RECOVERED_EVENT_TYPE,
        ]);
      });
    });

    describe("given the sync was revoked", () => {
      it("states nothing, so a straggling push cannot report a torn-down connection as healthy", async () => {
        const state = syncing({ state: "REVOKED", revokedCause: "teardown" });

        const facts = await guardsOver(state).recordScimUserPush({
          ...commandIdentity,
          userId: "user_sam",
          externalId: "u-1",
          op: "update",
        });

        expect(facts).toEqual([]);
      });
    });
  });

  describe("when an apply fails", () => {
    describe("given the failure could plausibly succeed next time", () => {
      it("states the failure alone, leaving it to be retried", async () => {
        const facts = await guardsOver(syncing()).recordScimApplyFailure({
          ...commandIdentity,
          op: "deactivate_user",
          errorCode: "offboard_incomplete",
          retryable: true,
          userId: "user_sam",
        });

        expect(facts.map((fact) => fact.type)).toEqual([
          SCIM_APPLY_FAILED_EVENT_TYPE,
        ]);
      });
    });

    describe("given the failure can never succeed", () => {
      /** @scenario A failure that will never succeed is retired visibly, never silently */
      it("retires it as a dead letter in the same append as the failure", async () => {
        const facts = await guardsOver(syncing()).recordScimApplyFailure({
          ...commandIdentity,
          op: "push_user",
          errorCode: "validation_error",
          retryable: false,
          userId: "user_sam",
        });

        expect(facts.map((fact) => fact.type)).toEqual([
          SCIM_APPLY_FAILED_EVENT_TYPE,
          SCIM_APPLY_RETIRED_EVENT_TYPE,
        ]);
      });
    });

    describe("given the directory has retried the identical failure to the limit", () => {
      /** @scenario A deactivate that cannot be applied is as visible as any other failure */
      it("retires it naming the person and the removal", async () => {
        const state = syncing({
          state: "ERROR",
          lastFailure: {
            op: "deactivate_user",
            errorCode: "offboard_incomplete",
            attempts: SCIM_APPLY_MAX_ATTEMPTS - 1,
            retiredAtMs: null,
            userId: "user_sam",
            occurredAtMs: T0 - 1,
          },
        });

        const facts = await guardsOver(state).recordScimApplyFailure({
          ...commandIdentity,
          op: "deactivate_user",
          errorCode: "offboard_incomplete",
          retryable: true,
          userId: "user_sam",
        });

        const retired = facts.find(
          (fact) => fact.type === SCIM_APPLY_RETIRED_EVENT_TYPE,
        );
        expect(retired?.data).toMatchObject({
          op: "deactivate_user",
          errorCode: "offboard_incomplete",
          attempts: SCIM_APPLY_MAX_ATTEMPTS,
          userId: "user_sam",
        });
      });
    });

    describe("given a failure that is not the one already standing", () => {
      it("counts it as a first attempt rather than compounding two problems", async () => {
        const state = syncing({
          state: "ERROR",
          lastFailure: {
            op: "deactivate_user",
            errorCode: "offboard_incomplete",
            attempts: SCIM_APPLY_MAX_ATTEMPTS - 1,
            retiredAtMs: null,
            userId: "user_sam",
            occurredAtMs: T0 - 1,
          },
        });

        const facts = await guardsOver(state).recordScimApplyFailure({
          ...commandIdentity,
          op: "deactivate_user",
          errorCode: "offboard_incomplete",
          retryable: true,
          userId: "user_other",
        });

        expect(facts.map((fact) => fact.type)).toEqual([
          SCIM_APPLY_FAILED_EVENT_TYPE,
        ]);
      });
    });

    /** @scenario The failure surface says nothing a customer should not read */
    it("states only ids, an operation and a reason code", async () => {
      const facts = await guardsOver(syncing()).recordScimApplyFailure({
        ...commandIdentity,
        op: "deactivate_user",
        errorCode: "offboard_incomplete",
        retryable: false,
        userId: "user_sam",
      });

      for (const fact of facts) {
        expect(Object.keys(fact.data).sort()).toEqual(
          expect.arrayContaining([
            "connectionId",
            "errorCode",
            "op",
            "organizationId",
            "scimSyncId",
          ]),
        );
        // Nothing that could carry a credential or a hostname.
        const serialized = JSON.stringify(fact.data);
        expect(serialized).not.toMatch(/token|secret|https?:\/\//i);
      }
    });
  });

  describe("when the sync is revoked", () => {
    it("states the revocation once and never twice", async () => {
      const first = await guardsOver(syncing()).revokeScimSync({
        ...commandIdentity,
        tokenId: "tok_1",
        cause: "revoke",
      });
      const second = await guardsOver(
        syncing({ state: "REVOKED", revokedCause: "revoke" }),
      ).revokeScimSync({
        ...commandIdentity,
        tokenId: "tok_1",
        cause: "revoke",
      });

      expect(first.map((fact) => fact.type)).toEqual([
        SCIM_TOKEN_REVOKED_EVENT_TYPE,
      ]);
      expect(second).toEqual([]);
    });
  });
});
