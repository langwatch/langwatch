import { beforeEach, describe, expect, it, vi } from "vitest";
import { tryGetApp } from "../../app";
import {
  authzGrantsCommands,
  resetAuthzGrantsCommandsForTests,
} from "../ledger";

vi.mock("../../app", () => ({
  tryGetApp: vi.fn(),
}));

const mockTryGetApp = vi.mocked(tryGetApp);

describe("authzGrantsCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `authzGrantsCommands` memoizes a SUCCESSFUL resolve for the process
    // lifetime (only failures clear the handle), and under `isolate: false`
    // that memoization can outlive this file. Reset it explicitly rather
    // than relying on test order within the file.
    resetAuthzGrantsCommandsForTests();
  });

  describe("when the stack is composed but event sourcing is disabled", () => {
    it("refuses immediately rather than letting a disabled pipeline swallow the send", async () => {
      mockTryGetApp.mockReturnValue({
        eventSourcing: { isEnabled: false },
      } as never);

      await expect(authzGrantsCommands({ waitMs: 0 })).rejects.toMatchObject({
        code: "authz_ledger_unavailable",
      });
    });
  });

  describe("when the event-sourcing stack is unavailable", () => {
    /** @scenario "Attaching a grant while the queue is unavailable fails loudly" */
    it("refuses with authz_ledger_unavailable instead of half-happening, and a later retry is not poisoned", async () => {
      mockTryGetApp.mockReturnValue(null as never);

      await expect(authzGrantsCommands({ waitMs: 0 })).rejects.toMatchObject({
        code: "authz_ledger_unavailable",
      });

      // The refusal clears the memoized handle: once the stack is back, the
      // same process resolves the senders rather than replaying the failure.
      const senders = { commands: { attachGrants: vi.fn() } };
      mockTryGetApp.mockReturnValue({
        eventSourcing: {
          isEnabled: true,
          getPipeline: vi.fn().mockReturnValue(senders),
        },
      } as never);

      await expect(authzGrantsCommands({ waitMs: 0 })).resolves.toBe(senders);
    });
  });
});
