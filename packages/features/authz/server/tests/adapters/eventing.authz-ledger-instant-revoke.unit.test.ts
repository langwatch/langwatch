import { describe, expect, it, vi } from "vitest";
import { RedisAuthzEpochAdapter } from "../../src/adapters/redis.authz-epoch.adapter";
import {
  ACTOR,
  ORG_ID,
  harness,
} from "../support/eventing.authz-ledger-fork.harness";

describe("EventingAuthzLedgerAdapter instant revocation", () => {
  /** @scenario "A revocation holds before the revoke call returns, with Redis stopped" */
  it("waits for append, marks only the named grant, and ignores epoch failure", async () => {
    const redis = {
      get: vi.fn().mockRejectedValue(new Error("redis stopped")),
      incr: vi.fn().mockRejectedValue(new Error("redis stopped")),
    };
    const epoch = RedisAuthzEpochAdapter.create({ redis });
    const { writer, db, sent } = harness({ onLedger: true, epoch });

    await expect(
      writer.revokeBindings({
        organizationId: ORG_ID,
        bindingIds: ["grant_revoked"],
        actor: ACTOR,
        reason: "offboarded",
      }),
    ).resolves.toBeUndefined();

    expect(sent).toEqual([
      expect.objectContaining({
        verb: "revokeGrant",
        data: expect.objectContaining({
          organizationId: ORG_ID,
          grantId: "grant_revoked",
          reason: "offboarded",
        }),
      }),
    ]);
    expect(db.grant.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        id: { in: ["grant_revoked"] },
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(1_700_000_000_000),
        revokedReason: "offboarded",
      },
    });
    expect(db.roleBinding.deleteMany).not.toHaveBeenCalled();
    expect(redis.incr).toHaveBeenCalledWith(`authz:epoch:${ORG_ID}`);
  });
});
