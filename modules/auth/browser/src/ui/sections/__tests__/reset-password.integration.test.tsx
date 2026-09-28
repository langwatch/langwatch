/**
 * @vitest-environment jsdom
 * Integration tests for /auth/reset-password: the full tree renders under
 * Chakra; only the BetterAuth client and the URL search-params hook are mocked.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockResetPassword, mockRegisterPasskey, publicEnvRef, searchParamsRef } = vi.hoisted(
  () => ({
    mockResetPassword: vi.fn(),
    mockRegisterPasskey: vi.fn(),
    publicEnvRef: { current: { PASSKEYS_ENABLED: true } as Record<string, unknown> },
    searchParamsRef: {
      current: new URLSearchParams("token=tok_valid") as URLSearchParams | null,
    },
  }),
);

vi.mock("../../../behavior/auth-client.tsx", () => ({
  authClient: { resetPassword: mockResetPassword },
}));

vi.mock("../../../behavior/ui-passkeys.ts", () => ({
  registerUiPasskey: mockRegisterPasskey,
}));

vi.mock("../../../behavior/use-public-env.ts", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

vi.mock("../../../behavior/use-route.ts", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

import ResetPassword from "../reset-password-screen.tsx";

const setToken = (token: string | null) => {
  searchParamsRef.current = token ? new URLSearchParams(`token=${token}`) : new URLSearchParams("");
};

const renderPage = () => {
  const view = render(
    <ChakraProvider value={defaultSystem}>
      <ResetPassword />
    </ChakraProvider>,
  );
  return view;
};

const passwordInputs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[];

const fillAndSubmit = ({
  container,
  password,
  confirm,
}: {
  container: HTMLElement;
  password: string;
  confirm: string;
}) => {
  const [pw, confirmPw] = passwordInputs(container);
  fireEvent.change(pw!, { target: { value: password } });
  fireEvent.change(confirmPw!, { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: /reset password/i }));
};

describe("ResetPassword page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetPassword.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    setToken("tok_valid");
    publicEnvRef.current = { PASSKEYS_ENABLED: true };
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the token is valid and the passwords match", () => {
    /** @scenario Submitting a valid new password with a token resets it and signs me in */
    it("calls resetPassword with the new password and token, then offers to continue", async () => {
      const { container } = renderPage();
      fillAndSubmit({
        container,
        password: "newsecret123",
        confirm: "newsecret123",
      });

      await waitFor(() => {
        expect(mockResetPassword).toHaveBeenCalledWith({
          newPassword: "newsecret123",
          token: "tok_valid",
        });
      });

      expect(await screen.findByRole("heading", { name: /password updated/i })).toBeTruthy();
      expect(screen.getByTestId("reset-sign-in").getAttribute("href")).toBe("/");
    });

    /** @scenario A completed reset offers a passkey rather than assuming one */
    it("offers a passkey without opening a device prompt", async () => {
      const { container } = renderPage();
      fillAndSubmit({ container, password: "newsecret123", confirm: "newsecret123" });

      expect(await screen.findByTestId("post-reset-passkey-offer")).toBeTruthy();
      expect(screen.getByTestId("reset-sign-in")).toBeTruthy();
      expect(mockRegisterPasskey).not.toHaveBeenCalled();
    });

    /** @scenario Declining the offer costs nothing */
    it("drops the offer when declined and keeps the way on", async () => {
      const { container } = renderPage();
      fillAndSubmit({ container, password: "newsecret123", confirm: "newsecret123" });

      fireEvent.click(await screen.findByTestId("reset-dismiss-passkey"));

      expect(screen.queryByTestId("post-reset-passkey-offer")).toBeNull();
      expect(screen.getByTestId("reset-sign-in")).toBeTruthy();
    });

    /** @scenario Accepting the offer adds the passkey on this screen */
    it("adds the passkey in place when accepted", async () => {
      mockRegisterPasskey.mockResolvedValue({ ok: true });
      const { container } = renderPage();
      fillAndSubmit({ container, password: "newsecret123", confirm: "newsecret123" });

      fireEvent.click(await screen.findByTestId("reset-add-passkey"));

      expect(await screen.findByTestId("reset-passkey-added")).toBeTruthy();
      expect(screen.getByTestId("reset-sign-in")).toBeTruthy();
    });

    /** @scenario A refused ceremony says so in words and leaves the way on */
    it("says a refused ceremony in words and keeps the way on", async () => {
      mockRegisterPasskey.mockResolvedValue({ ok: false, cancelled: false });
      const { container } = renderPage();
      fillAndSubmit({ container, password: "newsecret123", confirm: "newsecret123" });

      fireEvent.click(await screen.findByTestId("reset-add-passkey"));

      expect(await screen.findByText(/that passkey attempt didn't finish/i)).toBeTruthy();
      expect(screen.queryByText(/identity_passkey/)).toBeNull();
      expect(screen.getByTestId("reset-sign-in")).toBeTruthy();
    });

    it("offers no passkey where the deployment mounted none", async () => {
      publicEnvRef.current = {};
      const { container } = renderPage();
      fillAndSubmit({ container, password: "newsecret123", confirm: "newsecret123" });

      await screen.findByRole("heading", { name: /password updated/i });
      expect(screen.queryByTestId("post-reset-passkey-offer")).toBeNull();
    });
  });

  describe("when the new password is shorter than 8 characters", () => {
    /** @scenario The reset form rejects passwords shorter than 8 characters */
    it("shows a length validation error and does not call the reset endpoint", async () => {
      const { container } = renderPage();
      fillAndSubmit({ container, password: "short", confirm: "short" });

      // Length is enforced on the password field, so the message renders.
      expect((await screen.findAllByText(/at least 8 characters/i)).length).toBeGreaterThan(0);
      expect(mockResetPassword).not.toHaveBeenCalled();
    });
  });

  describe("when the confirmation does not match", () => {
    /** @scenario The reset form rejects a mismatched confirmation */
    it("shows a mismatch error and does not call the reset endpoint", async () => {
      const { container } = renderPage();
      fillAndSubmit({
        container,
        password: "newsecret123",
        confirm: "different123",
      });

      expect(await screen.findByText(/passwords don't match/i)).toBeTruthy();
      expect(mockResetPassword).not.toHaveBeenCalled();
    });
  });

  describe("when the token is invalid or expired", () => {
    /** @scenario An invalid or expired token surfaces an error and a way to retry */
    it("surfaces an invalid-or-expired error with a link to request a new reset", async () => {
      mockResetPassword.mockResolvedValueOnce({
        data: null,
        error: { code: "INVALID_TOKEN", message: "invalid token" },
      });
      setToken("tok_expired");
      const { container } = renderPage();
      fillAndSubmit({
        container,
        password: "newsecret123",
        confirm: "newsecret123",
      });

      expect(await screen.findByText(/reset link/i)).toBeTruthy();
      const retry = screen.getByRole("link", {
        name: /request a new reset link/i,
      });
      expect(retry.getAttribute("href")).toBe("/auth/forgot-password");
    });
  });

  describe("when the page is opened without a token", () => {
    /** @scenario Opening the reset page without a token prompts a new request */
    it("tells the user the link is invalid and offers to request a new one", () => {
      setToken(null);
      const { container } = renderPage();

      expect(screen.getByRole("heading", { name: /reset link didn't work/i })).toBeTruthy();
      expect(screen.getByRole("link", { name: /request a new reset link/i })).toBeTruthy();
      // No password form is rendered without a token.
      expect(passwordInputs(container)).toHaveLength(0);
    });
  });
});
