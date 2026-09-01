/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { impersonateUser } from "../behavior/admin-client";
import { ImpersonateDialog } from "../ui/sections/users-view";
import { fakeOpsHost, renderWithOpsHost, type FakeOpsHost } from "../../../testing";

vi.mock("../behavior/admin-client", () => ({
  impersonateUser: vi.fn().mockResolvedValue(undefined),
}));

/**
 * The refusal reaches the operator through the host, not through a module
 * singleton: `toaster.create({ type: "error" })` is a `failed` notice on
 * `OpsHostPort`, so the assertion reads the recording the fake host keeps.
 */
let host: FakeOpsHost;

const user = {
  id: "user-1",
  name: "Yoel Ernst",
  email: "yoel@example.com",
  image: null,
  emailVerified: true,
  pendingSsoSetup: false,
  createdAt: "2026-04-01T10:00:00.000Z",
  lastLoginAt: null,
  deactivatedAt: null,
  organizations: [],
  projects: [],
};

describe("Feature: Backoffice User Impersonation Reason", () => {
  beforeEach(() => {
    vi.mocked(impersonateUser).mockClear();
    host = fakeOpsHost({ isOpsAdmin: true });
  });

  describe("given the ops admin has opened the impersonation dialog", () => {
    /** @scenario Impersonation dialog asks for a single-line reason */
    it("shows a single-line reason field", () => {
      renderWithOpsHost(<ImpersonateDialog user={user} onClose={vi.fn()} />, { host });

      const reason = screen.getByLabelText("Reason");

      expect(screen.getByText(/saved to the audit log/i)).toBeInTheDocument();
      expect(reason.tagName).toBe("INPUT");
    });

    /** @scenario Impersonation dialog focuses the reason field on open */
    it("focuses the reason field as soon as the dialog opens", async () => {
      renderWithOpsHost(<ImpersonateDialog user={user} onClose={vi.fn()} />, { host });

      const reason = screen.getByLabelText("Reason");
      await waitFor(() => {
        expect(document.activeElement).toBe(reason);
      });
    });

    /** @scenario Enter submits a completed impersonation reason */
    it("submits the reason when Enter is pressed", async () => {
      const testingUser = userEvent.setup();
      renderWithOpsHost(<ImpersonateDialog user={user} onClose={vi.fn()} />, { host });

      await testingUser.type(screen.getByLabelText("Reason"), "support");
      fireEvent.keyDown(screen.getByLabelText("Reason"), {
        key: "Enter",
        code: "Enter",
      });

      await waitFor(() => {
        expect(impersonateUser).toHaveBeenCalledWith({
          userIdToImpersonate: "user-1",
          reason: "support",
        });
      });
    });

    /** @scenario Empty reason still blocks impersonation */
    it("keeps blocking empty reasons when Enter is pressed", async () => {
      renderWithOpsHost(<ImpersonateDialog user={user} onClose={vi.fn()} />, { host });

      fireEvent.keyDown(screen.getByLabelText("Reason"), {
        key: "Enter",
        code: "Enter",
      });

      expect(impersonateUser).not.toHaveBeenCalled();
      expect(host.recording.failures).toContainEqual(
        expect.objectContaining({ fallbackTitle: "Reason is required" }),
      );
    });
  });
});
