import { describe, expect, it } from "vitest";
import {
  emptyScimSync,
  reduceScimSync,
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_RECOVERED_EVENT_TYPE,
  SCIM_APPLY_RETIRED_EVENT_TYPE,
  SCIM_GROUP_MAPPED_EVENT_TYPE,
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  SCIM_TOKEN_REVOKED_EVENT_TYPE,
  SCIM_USER_PUSHED_EVENT_TYPE,
  type ScimSyncFact,
  type ScimSyncState,
  scimSyncIdFor,
} from "../scim-sync";

const CONNECTION = "conn_okta_primary";
const ORGANIZATION = "org_acme";
const SYNC = scimSyncIdFor({ connectionId: CONNECTION });
const T0 = 1_690_000_000_000;

const identity = {
  scimSyncId: SYNC,
  connectionId: CONNECTION,
  organizationId: ORGANIZATION,
};

function tokenIssued(occurredAt = T0): ScimSyncFact {
  return {
    type: SCIM_TOKEN_ISSUED_EVENT_TYPE,
    occurredAt,
    data: { ...identity, tokenId: "tok_1", actor: { type: "system", id: "system:scim" } },
  };
}

function userPushed(occurredAt = T0 + 1): ScimSyncFact {
  return {
    type: SCIM_USER_PUSHED_EVENT_TYPE,
    occurredAt,
    data: { ...identity, userId: "user_sam", externalId: "u-1", op: "create" },
  };
}

function applyFailed(
  overrides: Partial<{
    errorCode: string;
    retryable: boolean;
    userId: string | null;
    occurredAt: number;
  }> = {},
): ScimSyncFact {
  return {
    type: SCIM_APPLY_FAILED_EVENT_TYPE,
    occurredAt: overrides.occurredAt ?? T0 + 2,
    data: {
      ...identity,
      op: "deactivate_user",
      errorCode: overrides.errorCode ?? "offboard_incomplete",
      retryable: overrides.retryable ?? true,
      userId: overrides.userId === undefined ? "user_sam" : overrides.userId,
    },
  };
}

function fold(facts: ScimSyncFact[]): ScimSyncState {
  return facts.reduce(
    (state, fact) => reduceScimSync({ state, fact }),
    emptyScimSync({ scimSyncId: SYNC }),
  );
}

describe("reduceScimSync", () => {
  describe("given a connection whose token has just been minted", () => {
    it("holds the sync at TOKEN_ISSUED with nothing pushed", () => {
      const state = fold([tokenIssued()]);

      expect(state.state).toBe("TOKEN_ISSUED");
      expect(state.connectionId).toBe(CONNECTION);
      expect(state.lastPushedAtMs).toBeNull();
      expect(state.deadLetters).toEqual([]);
    });
  });

  describe("when the directory makes its first push", () => {
    it("moves the sync to SYNCING and records when", () => {
      const state = fold([tokenIssued(), userPushed(T0 + 5)]);

      expect(state.state).toBe("SYNCING");
      expect(state.lastPushedAtMs).toBe(T0 + 5);
    });
  });

  describe("when an apply fails", () => {
    it("moves the sync to ERROR naming the operation and a reason code", () => {
      const state = fold([tokenIssued(), userPushed(), applyFailed()]);

      expect(state.state).toBe("ERROR");
      expect(state.lastFailure).toMatchObject({
        op: "deactivate_user",
        errorCode: "offboard_incomplete",
        attempts: 1,
        retiredAtMs: null,
        userId: "user_sam",
      });
    });

    describe("when the identity provider retries the identical failure", () => {
      it("counts the attempts rather than starting over", () => {
        const state = fold([
          tokenIssued(),
          userPushed(),
          applyFailed({ occurredAt: T0 + 2 }),
          applyFailed({ occurredAt: T0 + 3 }),
          applyFailed({ occurredAt: T0 + 4 }),
        ]);

        expect(state.lastFailure?.attempts).toBe(3);
      });
    });

    describe("when the next failure is a different one", () => {
      it("starts the count again rather than compounding two problems", () => {
        const state = fold([
          tokenIssued(),
          userPushed(),
          applyFailed({ occurredAt: T0 + 2 }),
          applyFailed({ errorCode: "validation_error", occurredAt: T0 + 3 }),
        ]);

        expect(state.lastFailure).toMatchObject({
          errorCode: "validation_error",
          attempts: 1,
        });
      });
    });
  });

  describe("when a retryable failure recovers", () => {
    /** @scenario A retryable failure backs off and recovers on its own */
    it("returns the sync to SYNCING and clears the standing failure", () => {
      const state = fold([
        tokenIssued(),
        userPushed(),
        applyFailed(),
        {
          type: SCIM_APPLY_RECOVERED_EVENT_TYPE,
          occurredAt: T0 + 6,
          data: { ...identity, op: "deactivate_user" },
        },
      ]);

      expect(state.state).toBe("SYNCING");
      expect(state.lastFailure).toBeNull();
    });

    it("also recovers when the next push simply lands", () => {
      const state = fold([
        tokenIssued(),
        userPushed(),
        applyFailed(),
        userPushed(T0 + 7),
      ]);

      expect(state.state).toBe("SYNCING");
      expect(state.lastFailure).toBeNull();
    });
  });

  describe("when a failure is retired", () => {
    it("keeps it as a dead letter and refuses to call the sync healthy", () => {
      const state = fold([
        tokenIssued(),
        userPushed(),
        applyFailed(),
        {
          type: SCIM_APPLY_RETIRED_EVENT_TYPE,
          occurredAt: T0 + 8,
          data: {
            ...identity,
            op: "deactivate_user",
            errorCode: "offboard_incomplete",
            attempts: 5,
            userId: "user_sam",
          },
        },
      ]);

      expect(state.state).toBe("ERROR");
      expect(state.deadLetters).toHaveLength(1);
      expect(state.deadLetters[0]).toMatchObject({
        op: "deactivate_user",
        errorCode: "offboard_incomplete",
        attempts: 5,
        userId: "user_sam",
        retiredAtMs: T0 + 8,
      });
    });

    it("keeps the dead letter after the directory carries on working", () => {
      const state = fold([
        tokenIssued(),
        userPushed(),
        applyFailed(),
        {
          type: SCIM_APPLY_RETIRED_EVENT_TYPE,
          occurredAt: T0 + 8,
          data: {
            ...identity,
            op: "deactivate_user",
            errorCode: "offboard_incomplete",
            attempts: 5,
            userId: "user_sam",
          },
        },
        userPushed(T0 + 9),
      ]);

      expect(state.state).toBe("SYNCING");
      expect(state.deadLetters).toHaveLength(1);
      expect(state.deadLetters[0]?.userId).toBe("user_sam");
    });
  });

  describe("when the sync is revoked", () => {
    it("records the cause and keeps every dead letter", () => {
      const state = fold([
        tokenIssued(),
        userPushed(),
        applyFailed(),
        {
          type: SCIM_APPLY_RETIRED_EVENT_TYPE,
          occurredAt: T0 + 8,
          data: {
            ...identity,
            op: "deactivate_user",
            errorCode: "offboard_incomplete",
            attempts: 5,
            userId: "user_sam",
          },
        },
        {
          type: SCIM_TOKEN_REVOKED_EVENT_TYPE,
          occurredAt: T0 + 9,
          data: { ...identity, tokenId: null, cause: "teardown" },
        },
      ]);

      expect(state.state).toBe("REVOKED");
      expect(state.revokedCause).toBe("teardown");
      expect(state.deadLetters).toHaveLength(1);
    });

    it("stays revoked when a straggling push arrives afterwards", () => {
      const state = fold([
        tokenIssued(),
        userPushed(),
        {
          type: SCIM_TOKEN_REVOKED_EVENT_TYPE,
          occurredAt: T0 + 9,
          data: { ...identity, tokenId: "tok_1", cause: "teardown" },
        },
        userPushed(T0 + 10),
        {
          type: SCIM_GROUP_MAPPED_EVENT_TYPE,
          occurredAt: T0 + 11,
          data: { ...identity, groupId: "grp_1", externalId: "g-1" },
        },
      ]);

      expect(state.state).toBe("REVOKED");
      expect(state.lastPushedAtMs).toBe(T0 + 1);
    });
  });

  describe("given the whole history replayed twice", () => {
    it("answers the same state, because the reducer is pure and total", () => {
      const history = [tokenIssued(), userPushed(), applyFailed()];

      expect(fold(history)).toEqual(fold(history));
    });
  });
});

describe("scimSyncIdFor", () => {
  it("derives the sync from the connection, so no lookup stands between them", () => {
    expect(scimSyncIdFor({ connectionId: "conn_x" })).toBe("conn_x");
  });
});
