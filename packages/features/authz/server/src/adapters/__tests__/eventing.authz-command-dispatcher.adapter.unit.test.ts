/**
 * Spec: packages/features/authz/specs/grants-command-dispatch.feature
 */
import { describe, expect, it, vi } from "vitest";
import { AuthzLedgerUnavailableError } from "../../ports/authz-grants-command-dispatcher.port";
import type { AuthzGrantsCommandSenders } from "../../ports/authz-grants-command-dispatcher.port";
import { EventingAuthzCommandDispatcherAdapter } from "../eventing.authz-command-dispatcher.adapter";

function senders(): AuthzGrantsCommandSenders {
  const send = vi.fn(async () => undefined);
  return {
    attachGrant: { send },
    changeGrantRole: { send },
    revokeGrant: { send },
    defineRole: { send },
    changeRolePermissions: { send },
    deleteRole: { send },
  };
}

const COMMAND_NAMES = [
  "attachGrant",
  "changeGrantRole",
  "revokeGrant",
  "defineRole",
  "changeRolePermissions",
  "deleteRole",
] as const;

describe("EventingAuthzCommandDispatcherAdapter", () => {
  describe("when a registration connects before a write arrives", () => {
    /** @scenario "A connected dispatcher resolves the registration's senders" */
    it("hands back the senders the registration produced", async () => {
      const dispatcher = EventingAuthzCommandDispatcherAdapter.create();
      const connected = senders();

      dispatcher.connect(connected);

      await expect(dispatcher.commands()).resolves.toEqual({ commands: connected });
    });
  });

  describe("when a write arrives before the registration", () => {
    /** @scenario "A write that arrives before the registration waits for it" */
    it("waits for the connection rather than refusing immediately", async () => {
      const dispatcher = EventingAuthzCommandDispatcherAdapter.create({ waitMs: 200 });
      const connected = senders();

      const pending = dispatcher.commands();
      dispatcher.connect(connected);

      await expect(pending).resolves.toEqual({ commands: connected });
    });

    /** @scenario "A registration that never lands refuses rather than falling through" */
    it("refuses with a ledger-unavailable error once the wait elapses", async () => {
      const dispatcher = EventingAuthzCommandDispatcherAdapter.create({ waitMs: 5 });

      await expect(dispatcher.commands()).rejects.toBeInstanceOf(AuthzLedgerUnavailableError);
    });
  });

  describe("when a second registration connects", () => {
    /** @scenario "Two registrations of one pipeline in one process are refused" */
    it("refuses a different set of senders and accepts the same set again", () => {
      const dispatcher = EventingAuthzCommandDispatcherAdapter.create();
      const first = senders();

      dispatcher.connect(first);

      expect(() => dispatcher.connect(first)).not.toThrow();
      expect(() => dispatcher.connect(senders())).toThrow(/already connected/);
    });
  });

  describe("when senders are narrowed from a registration", () => {
    /** @scenario "An incomplete registration is refused where it is narrowed" */
    it("refuses a registration missing a command instead of asserting over it", () => {
      const complete = senders();
      const { revokeGrant: _dropped, ...incomplete } = complete;

      expect(() => EventingAuthzCommandDispatcherAdapter.sendersFrom(incomplete)).toThrow(
        /revokeGrant/,
      );
    });

    /** @scenario "An incomplete registration is refused where it is narrowed" */
    it("refuses a command entry that is not a sender", () => {
      expect(() =>
        EventingAuthzCommandDispatcherAdapter.sendersFrom({
          ...senders(),
          attachGrant: "not-a-sender",
        }),
      ).toThrow(/attachGrant/);
    });

    /** @scenario "A complete registration forwards every command it names" */
    it("forwards every one of the six commands to the registration that produced it", async () => {
      const registered = Object.fromEntries(
        COMMAND_NAMES.map((name) => [name, { send: vi.fn(async () => name) }]),
      );

      const narrowed = EventingAuthzCommandDispatcherAdapter.sendersFrom(registered);
      for (const name of COMMAND_NAMES) {
        await narrowed[name].send({} as never);
      }

      for (const name of COMMAND_NAMES) {
        expect(registered[name]!.send).toHaveBeenCalledTimes(1);
      }
    });
  });
});
