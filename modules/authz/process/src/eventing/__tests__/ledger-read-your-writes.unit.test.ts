/**
 * Bounded read-your-writes hold; caller can require projection or pass if
 * fold converges.
 */
import { HandledError } from "@langwatch/handled-error";
import { toDate } from "@langwatch/time";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { grantFactToRow } from "../../repositories/prisma/prisma.authz-grant.mapper.ts";
import { ACTOR, binding, harness, ORG_ID } from "./support/eventing.authz-ledger-fork.harness.ts";

/** A Grant row as Postgres returns it: Dates where the mapped shape holds Instants. */
const storedRow = (args: Parameters<typeof grantFactToRow>[0]) => {
  const row = grantFactToRow(args);
  return {
    ...row,
    expiresAt: row.expiresAt ? toDate(row.expiresAt) : null,
    occurredAt: toDate(row.occurredAt),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

/** The code of a handled failure, or the error itself when it is not one. */
async function codeOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : error;
  }
  return null;
}

describe("given an attach whose projection does not land inside the window", () => {
  describe("when the caller uses the default read-your-writes contract", () => {
    /** @scenario "A default write fails when its projection lags" */
    it("refuses with authz_grant_not_confirmed", async () => {
      const { writer } = harness({});

      expect(
        await codeOf(() =>
          writer.attachBindings({
            organizationId: ORG_ID,
            bindings: [binding],
            actor: ACTOR,
            onDuplicate: "skip",
          }),
        ),
      ).toBe("authz_grant_not_confirmed");
    });
  });

  describe("when the caller explicitly writes asynchronously", () => {
    /** @scenario "An asynchronous write is accepted before its projection lands" */
    it("reports the durable append without reading the projection", async () => {
      const { writer, db } = harness({});

      const outcome = await writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [binding],
        actor: ACTOR,
        onDuplicate: "skip",
        awaitProjection: false,
      });

      expect(outcome.attached).toEqual(["rb_1"]);
      expect(db.grant.count).not.toHaveBeenCalled();
    });

    it("stamps USER attaches with the locked membership lifetime", async () => {
      const { writer, sent } = harness({});

      await writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [binding],
        actor: ACTOR,
        onDuplicate: "skip",
        awaitProjection: false,
      });

      expect(sent[0]?.data).toMatchObject({
        grant: { membershipStamp: "stamp_user_sam" },
      });
    });
  });

  describe("when the caller requires the projection", () => {
    /** @scenario "A write whose caller requires the projection fails when it lags" */
    it("refuses with authz_grant_not_confirmed", async () => {
      const { writer } = harness({});

      expect(
        await codeOf(() =>
          writer.attachBindings({
            organizationId: ORG_ID,
            bindings: [binding],
            actor: ACTOR,
            onDuplicate: "skip",
            requireProjection: true,
          }),
        ),
      ).toBe("authz_grant_not_confirmed");
    });

    /** @scenario "Requiring the projection waits for it even when the wait is switched off" */
    it("waits and refuses even when the caller switched the wait off", async () => {
      const { writer } = harness({});

      expect(
        await codeOf(() =>
          writer.attachBindings({
            organizationId: ORG_ID,
            bindings: [binding],
            actor: ACTOR,
            onDuplicate: "skip",
            awaitProjection: false,
            requireProjection: true,
          }),
        ),
      ).toBe("authz_grant_not_confirmed");
    });

    it("reports the failure as ours, not the caller's", async () => {
      const { writer } = harness({});

      let caught: unknown;
      try {
        await writer.attachBindings({
          organizationId: ORG_ID,
          bindings: [binding],
          actor: ACTOR,
          onDuplicate: "skip",
          requireProjection: true,
        });
      } catch (error) {
        caught = error;
      }

      expect(HandledError.isHandled(caught)).toBe(true);
      const handled = caught as HandledError;
      expect(handled.fault).toBe("platform");
      expect(handled.httpStatus).toBe(503);
    });
  });
});

describe("given an attach whose projection lands inside the window", () => {
  describe("when the caller requires the projection", () => {
    /** @scenario "A required write that lands inside the window passes" */
    it("reports the write as done", async () => {
      const { writer, db } = harness({});
      db.grant.count.mockResolvedValue(1);

      const outcome = await writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [binding],
        actor: ACTOR,
        onDuplicate: "skip",
        requireProjection: true,
      });

      expect(outcome.attached).toEqual(["rb_1"]);
    });

    /** @scenario "A compatibility-only row cannot confirm an attach" */
    it("does not accept a compatibility-only row as confirmation", async () => {
      const { writer, db } = harness({});
      db.roleBinding.count.mockResolvedValue(1);

      expect(
        await codeOf(() =>
          writer.attachBindings({
            organizationId: ORG_ID,
            bindings: [binding],
            actor: ACTOR,
            onDuplicate: "skip",
          }),
        ),
      ).toBe("authz_grant_not_confirmed");
      expect(db.grant.count).toHaveBeenCalled();
    });

    /** @scenario "A revoked Grant cannot confirm an attach" */
    it("does not accept a revoked Grant row as confirmation", async () => {
      const { writer, db } = harness({});
      db.grant.count.mockImplementation(async ({ where }) => {
        expect(where).toEqual(expect.objectContaining({ revokedAt: null }));
        return 0;
      });

      expect(
        await codeOf(() =>
          writer.attachBindings({
            organizationId: ORG_ID,
            bindings: [binding],
            actor: ACTOR,
            onDuplicate: "skip",
          }),
        ),
      ).toBe("authz_grant_not_confirmed");
    });

    /** @scenario "A delayed Grant projection confirms an attach" */
    it("resolves when the actual Grant projection arrives during the window", async () => {
      const { writer, db } = harness({
        poll: { intervalMs: 1, timeoutMs: 100 },
      });
      let countCalls = 0;
      db.grant.count.mockImplementation(async () => {
        countCalls += 1;
        return countCalls > 1 ? 1 : 0;
      });

      await expect(
        writer.attachBindings({
          organizationId: ORG_ID,
          bindings: [binding],
          actor: ACTOR,
          onDuplicate: "skip",
        }),
      ).resolves.toMatchObject({ attached: ["rb_1"] });
      expect(countCalls).toBeGreaterThan(1);
    });
  });
});

describe("given a role definition whose projection does not land inside the window", () => {
  describe("when the caller requires the projection", () => {
    /** @scenario "A role definition whose caller requires the projection fails when it lags" */
    it("refuses with authz_grant_not_confirmed", async () => {
      const { writer } = harness({});

      expect(
        await codeOf(() =>
          writer.defineRole({
            organizationId: ORG_ID,
            roleId: "role_1",
            name: "apikey:key_1",
            permissions: ["langy:view"],
            kind: "system_api_key",
            actor: ACTOR,
            requireProjection: true,
          }),
        ),
      ).toBe("authz_grant_not_confirmed");
    });
  });

  describe("when the caller does not require the projection", () => {
    it("reports the write as done", async () => {
      const { writer, db } = harness({});

      await expect(
        writer.defineRole({
          organizationId: ORG_ID,
          roleId: "role_1",
          name: "apikey:key_1",
          permissions: ["langy:view"],
          kind: "system_api_key",
          actor: ACTOR,
          requireProjection: false,
        }),
      ).resolves.toBeUndefined();
      expect(db.role.findFirst).toHaveBeenCalled();
    });
  });

  describe("when the canonical Role projection lands", () => {
    /** @scenario "A role definition is confirmed by the canonical Role projection" */
    it("confirms the defined role's name and permissions", async () => {
      const { writer, db } = harness({});
      db.role.findFirst.mockResolvedValue({
        name: "apikey:key_1",
        permissions: ["langy:view"],
      });

      await expect(
        writer.defineRole({
          organizationId: ORG_ID,
          roleId: "role_1",
          name: "apikey:key_1",
          permissions: ["langy:view"],
          kind: "system_api_key",
          actor: ACTOR,
        }),
      ).resolves.toBeUndefined();
      expect(db.role.findFirst).toHaveBeenCalledWith({
        where: { id: "role_1", organizationId: ORG_ID, deletedAt: null },
        select: { name: true, permissions: true },
      });
    });

    it("does not accept a deleted Role row as confirmation", async () => {
      const { writer, db } = harness({});
      db.role.findFirst.mockResolvedValue(null);

      expect(
        await codeOf(() =>
          writer.defineRole({
            organizationId: ORG_ID,
            roleId: "role_1",
            name: "apikey:key_1",
            permissions: ["langy:view"],
            kind: "system_api_key",
            actor: ACTOR,
          }),
        ),
      ).toBe("authz_grant_not_confirmed");
    });
  });
});

describe("given a binding role change", () => {
  /** @scenario "A changed binding role is confirmed by the canonical Grant projection" */
  it("confirms the changed role on the canonical Grant row", async () => {
    const { writer, db } = harness({});
    db.grant.findFirst
      .mockResolvedValueOnce(
        storedRow({
          organizationId: ORG_ID,
          grant: {
            grantId: "known",
            roleKey: "member",
            principal: { type: "user", id: "user_sam" },
            scope: { type: "TEAM", id: "team_support" },
            source: "grants-service",
            occurredAtMs: 1_700_000_000_000,
          },
        }),
      )
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ roleKey: "viewer" });

    await expect(
      writer.changeBindingRole({
        organizationId: ORG_ID,
        bindingId: "known",
        role: "VIEWER",
        customRoleId: null,
        actor: ACTOR,
      }),
    ).resolves.toBeUndefined();
    expect(db.grant.findFirst).toHaveBeenLastCalledWith({
      where: { id: "known", organizationId: ORG_ID, revokedAt: null },
      select: { roleKey: true },
    });
  });
});

describe("given a role deletion", () => {
  /** @scenario "A deleted role is confirmed when the canonical Role projection is gone" */
  it("confirms that the canonical Role row is gone", async () => {
    const { writer, db } = harness({});
    db.role.findFirst.mockResolvedValue(null);

    await expect(
      writer.deleteRole({
        organizationId: ORG_ID,
        roleId: "role_1",
        actor: ACTOR,
      }),
    ).resolves.toBeUndefined();
    expect(db.role.findFirst).toHaveBeenLastCalledWith({
      where: { id: "role_1", organizationId: ORG_ID, deletedAt: null },
      select: { id: true },
    });
  });
});
