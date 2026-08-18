import { beforeEach, describe, expect, it, vi } from "vitest";
import { tryGetApp } from "../../app";
import { authzGrantsCommands } from "../ledger";

vi.mock("../../app", () => ({
  tryGetApp: vi.fn(),
}));

const mockTryGetApp = vi.mocked(tryGetApp);

// Order matters here: `authzGrantsCommands` memoizes a SUCCESSFUL resolve for
// the process lifetime (only failures clear the handle), so the case that
// ends in a resolve must run last.
describe("authzGrantsCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    /** @scenario "A migrated organization's grant write refuses while the ledger is unavailable" */
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
