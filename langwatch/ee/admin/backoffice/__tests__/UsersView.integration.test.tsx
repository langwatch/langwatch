/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toaster } from "~/components/ui/toaster";
import { impersonateUser } from "../adminClient";
import { ImpersonateDialog } from "../resources/UsersView";

vi.mock("../adminClient", () => ({
  impersonateUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: {
    create: vi.fn(),
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

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
    vi.mocked(toaster.create).mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the ops admin has opened the impersonation dialog", () => {
    /** @scenario Impersonation dialog asks for a single-line reason */
    it("shows a single-line reason field", () => {
      render(<ImpersonateDialog user={user} onClose={vi.fn()} />, {
        wrapper: Wrapper,
      });

      const reason = screen.getByLabelText("Reason");

      expect(screen.getByText(/saved to the audit log/i)).toBeInTheDocument();
      expect(reason.tagName).toBe("INPUT");
    });

    /** @scenario Enter submits a completed impersonation reason */
    it("submits the reason when Enter is pressed", async () => {
      const testingUser = userEvent.setup();
      render(<ImpersonateDialog user={user} onClose={vi.fn()} />, {
        wrapper: Wrapper,
      });

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
      render(<ImpersonateDialog user={user} onClose={vi.fn()} />, {
        wrapper: Wrapper,
      });

      fireEvent.keyDown(screen.getByLabelText("Reason"), {
        key: "Enter",
        code: "Enter",
      });

      expect(impersonateUser).not.toHaveBeenCalled();
      expect(toaster.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Reason is required",
          type: "error",
        }),
      );
    });
  });
});
