// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A removal, and what it has to prove (D08).
 *
 * These drive `ScimDeprovisionService` against a fake `GrantsService` so the
 * ROUTING is what is asserted: that a removal goes through the service whose
 * proof runs, that a failed proof changes nothing and is surfaced, and that
 * what needs a person is answered rather than guessed at.
 *
 * The proof ITSELF — that nothing resolves for the person once the
 * transaction commits — cannot be asserted here: it lives inside the
 * repository's transaction and needs a real database. That is
 * `scim-offboard-postcondition.integration.test.ts`.
 */
import { OffboardIncompleteError } from "@langwatch/authz-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScimDeprovisionService } from "../scim-deprovision.service";

const ORGANIZATION = "org_acme";
const CONNECTION = "conn_okta_primary";
const USER = "user_sam";

const EMPTY_MANIFEST = { ownedApiKeys: [], personalTeams: [] };

function createGrants(
  result: {
    needsHumanDecision: {
      ownedApiKeys: Array<{ id: string; name: string }>;
      personalTeams: Array<{ id: string; name: string }>;
    };
  } = { needsHumanDecision: EMPTY_MANIFEST },
) {
  return {
    offboard: vi.fn().mockResolvedValue({ removed: {}, ...result }),
  };
}

function createSyncLifecycle() {
  return { applyFailed: vi.fn().mockResolvedValue(undefined) };
}

describe("ScimDeprovisionService", () => {
  let grants: ReturnType<typeof createGrants>;
  let syncLifecycle: ReturnType<typeof createSyncLifecycle>;

  beforeEach(() => {
    grants = createGrants();
    syncLifecycle = createSyncLifecycle();
  });

  function service() {
    return new ScimDeprovisionService({
      grants: grants as never,
      syncLifecycle: syncLifecycle as never,
    });
  }

  describe("when the directory deletes somebody", () => {
    it("removes their access through the service whose proof runs, as the directory", async () => {
      await service().removeAccess({
        userId: USER,
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        op: "delete_user",
      });

      expect(grants.offboard).toHaveBeenCalledWith({
        actor: { type: "system", name: "scim" },
        userId: USER,
        organizationId: ORGANIZATION,
      });
    });
  });

  describe("when the directory pushes somebody inactive", () => {
    /** @scenario The proof runs on every path a directory can remove somebody by */
    it("takes the identical path a deletion does", async () => {
      await service().removeAccess({
        userId: USER,
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        op: "deactivate_user",
      });

      expect(grants.offboard).toHaveBeenCalledWith({
        actor: { type: "system", name: "scim" },
        userId: USER,
        organizationId: ORGANIZATION,
      });
    });
  });

  describe("when the proof still finds something resolving", () => {
    beforeEach(() => {
      grants.offboard = vi
        .fn()
        .mockRejectedValue(
          new OffboardIncompleteError({ remainingBindings: 1 }),
        );
    });

    /** @scenario A removal that cannot prove itself empty fails loudly */
    /** @scenario A deprovision that cannot prove itself empty fails loudly */
    it("refuses with offboard_incomplete rather than reporting success", async () => {
      await expect(
        service().removeAccess({
          userId: USER,
          organizationId: ORGANIZATION,
          connectionId: CONNECTION,
          op: "delete_user",
        }),
      ).rejects.toMatchObject({
        code: "offboard_incomplete",
        httpStatus: 500,
      });
    });

    it("surfaces it as a dead letter naming the person and the operation", async () => {
      await service()
        .removeAccess({
          userId: USER,
          organizationId: ORGANIZATION,
          connectionId: CONNECTION,
          op: "deactivate_user",
        })
        .catch(() => undefined);

      expect(syncLifecycle.applyFailed).toHaveBeenCalledWith({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        op: "deactivate_user",
        errorCode: "offboard_incomplete",
        // A platform fault could plausibly succeed on the next attempt, so it
        // backs off; the guard retires it once the directory has retried the
        // identical failure enough times.
        retryable: true,
        userId: USER,
      });
    });

    it("names a reason CODE, never the error's prose", async () => {
      await service()
        .removeAccess({
          userId: USER,
          organizationId: ORGANIZATION,
          connectionId: CONNECTION,
          op: "delete_user",
        })
        .catch(() => undefined);

      const [failure] = syncLifecycle.applyFailed.mock.calls[0] as [
        { errorCode: string },
      ];
      expect(failure.errorCode).toBe("offboard_incomplete");
      expect(failure.errorCode).not.toMatch(/\s/);
    });
  });

  describe("when the failure is one we cannot name", () => {
    it("records it as retryable, rather than retiring a problem nobody understands", async () => {
      grants.offboard = vi.fn().mockRejectedValue(new Error("connection lost"));

      await service()
        .removeAccess({
          userId: USER,
          organizationId: ORGANIZATION,
          connectionId: CONNECTION,
          op: "delete_user",
        })
        .catch(() => undefined);

      expect(syncLifecycle.applyFailed).toHaveBeenCalledWith(
        expect.objectContaining({ errorCode: "unknown", retryable: true }),
      );
    });
  });

  describe("when the person owned credentials or a personal team", () => {
    /** @scenario A removal decision needing a person is surfaced, not guessed at */
    it("removes their access anyway and answers what needs a decision", async () => {
      grants = createGrants({
        needsHumanDecision: {
          ownedApiKeys: [{ id: "key_1", name: "CI key" }],
          personalTeams: [{ id: "team_1", name: "Sam's team" }],
        },
      });

      const manifest = await service().removeAccess({
        userId: USER,
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        op: "delete_user",
      });

      expect(grants.offboard).toHaveBeenCalled();
      expect(manifest).toEqual({
        ownedApiKeys: [{ id: "key_1", name: "CI key" }],
        personalTeams: [{ id: "team_1", name: "Sam's team" }],
      });
    });
  });

  describe("given a token that predates connection scoping", () => {
    it("still removes and proves, with nowhere to attribute a failure to", async () => {
      grants.offboard = vi
        .fn()
        .mockRejectedValue(new OffboardIncompleteError({}));

      await service()
        .removeAccess({
          userId: USER,
          organizationId: ORGANIZATION,
          connectionId: null,
          op: "delete_user",
        })
        .catch(() => undefined);

      expect(grants.offboard).toHaveBeenCalled();
      expect(syncLifecycle.applyFailed).not.toHaveBeenCalled();
    });
  });
});
