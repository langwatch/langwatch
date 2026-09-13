/**
 * The bounded read-your-writes hold, and what a caller can ask it to do when
 * the projection does not land inside the window.
 *
 * The append is durable either way, so most callers pass: the fold converges
 * and the rows appear. A caller whose next step hands out access those rows
 * decide asks for `requireProjection` and is refused instead.
 *
 * @see specs/rbac/authz-grants.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../epoch", () => ({
  bumpAuthzEpoch: vi.fn().mockResolvedValue(undefined),
}));

import { HandledError } from "@langwatch/handled-error";
import { ACTOR, binding, harness, ORG_ID } from "./ledger-write-fork.harness";

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
  describe("when the caller does not require the projection", () => {
    /** @scenario "A write that nobody reads next passes when the projection lags" */
    it("reports the write as done", async () => {
      const { writer } = harness({ onLedger: true });

      const outcome = await writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [binding],
        actor: ACTOR,
        onDuplicate: "skip",
      });

      expect(outcome.attached).toEqual(["rb_1"]);
    });
  });

  describe("when the caller requires the projection", () => {
    /** @scenario "A write whose caller requires the projection fails when it lags" */
    it("refuses with authz_grant_not_confirmed", async () => {
      const { writer } = harness({ onLedger: true });

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
      const { writer } = harness({ onLedger: true });

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
      const { writer } = harness({ onLedger: true });

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
      const { writer, db } = harness({ onLedger: true });
      db.roleBinding.count.mockResolvedValue(1);

      const outcome = await writer.attachBindings({
        organizationId: ORG_ID,
        bindings: [binding],
        actor: ACTOR,
        onDuplicate: "skip",
        requireProjection: true,
      });

      expect(outcome.attached).toEqual(["rb_1"]);
    });
  });
});

describe("given a role definition whose projection does not land inside the window", () => {
  describe("when the caller requires the projection", () => {
    /** @scenario "A role definition whose caller requires the projection fails when it lags" */
    it("refuses with authz_grant_not_confirmed", async () => {
      const { writer } = harness({ onLedger: true });

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
      const { writer } = harness({ onLedger: true });

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
    });
  });
});
