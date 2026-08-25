/**
 * @vitest-environment jsdom
 *
 * The /auth/reset-password screen. The full component tree renders under
 * Chakra; only the BetterAuth client, the public-env hook and the URL
 * search-params hook are mocked — the error registry is the real one, because
 * what the screen SAYS about a refusal is half of what these tests are for.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockResetPassword, searchParamsRef, publicEnvRef } = vi.hoisted(() => ({
  mockResetPassword: vi.fn(),
  searchParamsRef: {
    current: new URLSearchParams("token=tok_valid") as URLSearchParams | null,
  },
  publicEnvRef: {
    current: {
      NEXTAUTH_PROVIDER: "email",
      IDENTITY_FRONT_DOOR: false,
      PASSKEYS_ENABLED: false,
    } as Record<string, unknown>,
  },
}));

vi.mock("~/utils/auth-client", () => ({
  authClient: { resetPassword: mockResetPassword },
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

vi.mock("~/utils/compat/next-navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

vi.mock("~/utils/compat/next-link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import ResetPassword from "../reset-password";

const setToken = (token: string | null) => {
  searchParamsRef.current = token
    ? new URLSearchParams(`token=${token}`)
    : new URLSearchParams("");
};

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <ResetPassword />
    </ChakraProvider>,
  );

const passwordInputs = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll('input[type="password"]'),
  ) as HTMLInputElement[];

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

const resetSuccessfully = async () => {
  const { container } = renderPage();
  fillAndSubmit({
    container,
    password: "newsecret123",
    confirm: "newsecret123",
  });
  await screen.findByRole("heading", { name: /password updated/i });
};

describe("ResetPassword page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetPassword.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    setToken("tok_valid");
    publicEnvRef.current = {
      NEXTAUTH_PROVIDER: "email",
      IDENTITY_FRONT_DOOR: false,
      PASSKEYS_ENABLED: false,
    };
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the token is valid and the passwords match", () => {
    /** @scenario Submitting a valid new password with a token resets it and returns to sign-in */
    it("calls resetPassword with the new password and token, then confirms with a sign-in link", async () => {
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

      expect(
        await screen.findByRole("heading", { name: /password updated/i }),
      ).toBeTruthy();
      const signInLink = screen.getByTestId("reset-sign-in");
      expect(signInLink.getAttribute("href")).toBe("/auth/signin");
    });
  });

  describe("when the new password is shorter than 8 characters", () => {
    /** @scenario The reset form rejects passwords shorter than 8 characters */
    it("shows a length validation error and does not call the reset endpoint", async () => {
      const { container } = renderPage();
      fillAndSubmit({ container, password: "short", confirm: "short" });

      // Length is enforced on the password field, so the message renders.
      expect(
        (await screen.findAllByText(/at least 8 characters/i)).length,
      ).toBeGreaterThan(0);
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
    it("surfaces an expired-or-used error with a link to request a new reset", async () => {
      mockResetPassword.mockResolvedValueOnce({
        data: null,
        // The translated body: the auth boundary re-answers `INVALID_TOKEN` on
        // /reset-password as our own code, and the flat REST shape is what
        // `readHandledError` lifts it off.
        error: { error: "identity_reset_link_invalid", status: 400 },
      });
      setToken("tok_expired");
      const { container } = renderPage();
      fillAndSubmit({
        container,
        password: "newsecret123",
        confirm: "newsecret123",
      });

      expect(
        await screen.findByText(/expired or already been used/i),
      ).toBeTruthy();
      const retry = screen.getByRole("link", {
        name: /request a new reset link/i,
      });
      expect(retry.getAttribute("href")).toBe("/auth/forgot-password");
    });

    /** @scenario A refused reset says why in words from the registry */
    it("never puts the code itself or a raw message on screen", async () => {
      mockResetPassword.mockResolvedValueOnce({
        data: null,
        error: {
          error: "identity_reset_link_invalid",
          message: "identity_reset_link_invalid",
          status: 400,
        },
      });
      const { container } = renderPage();
      fillAndSubmit({
        container,
        password: "newsecret123",
        confirm: "newsecret123",
      });

      await screen.findByText(/expired or already been used/i);
      expect(document.body.textContent).not.toContain(
        "identity_reset_link_invalid",
      );
    });
  });

  describe("when the password itself is refused rather than the link", () => {
    /** @scenario A refused reset says why in words from the registry */
    it("keeps the form live and does not offer a fresh link", async () => {
      mockResetPassword.mockResolvedValueOnce({
        data: null,
        error: { error: "identity_password_rejected", status: 400 },
      });
      const { container } = renderPage();
      fillAndSubmit({
        container,
        password: "newsecret123",
        confirm: "newsecret123",
      });

      expect(await screen.findByText(/wasn't accepted/i)).toBeTruthy();
      // A new link is the remedy only when the link is the problem: offered
      // here it sends somebody to burn a fresh one and meet the same wall.
      expect(
        screen.queryByRole("link", { name: /request a new reset link/i }),
      ).toBeNull();
      expect(passwordInputs(container)).toHaveLength(2);
    });
  });

  describe("when the page is opened without a token", () => {
    /** @scenario Opening the reset page without a token prompts a new request */
    it("tells the user the link is invalid and offers to request a new one", () => {
      setToken(null);
      const { container } = renderPage();

      expect(
        screen.getByRole("heading", { name: /that reset link didn't work/i }),
      ).toBeTruthy();
      expect(
        screen.getByRole("link", { name: /request a new reset link/i }),
      ).toBeTruthy();
      // No password form is rendered without a token.
      expect(passwordInputs(container)).toHaveLength(0);
    });
  });

  describe("given a deployment whose auth screens takes passkeys", () => {
    beforeEach(() => {
      publicEnvRef.current = {
        NEXTAUTH_PROVIDER: "email",
        IDENTITY_FRONT_DOOR: true,
        PASSKEYS_ENABLED: true,
      };
    });

    describe("when the reset completes", () => {
      /** @scenario A completed reset offers a passkey rather than assuming one */
      it("offers a passkey beside the plain way on, not in front of it", async () => {
        await resetSuccessfully();

        expect(screen.getByTestId("post-reset-passkey-offer")).toBeTruthy();
        // The plain action is still the unmissable one.
        expect(screen.getByTestId("reset-sign-in").getAttribute("href")).toBe(
          "/auth/signin",
        );
        expect(
          screen.getByTestId("reset-add-passkey").getAttribute("href"),
        ).toContain("callbackUrl=");
      });

      /** @scenario A completed reset offers a passkey rather than assuming one */
      it("opens no device prompt of its own", async () => {
        await resetSuccessfully();

        // The offer is a link to the one place a passkey can be made. A
        // completed reset ends every session, so no ceremony could run here —
        // and the real-gesture rule is kept for free.
        expect(screen.queryByTestId("passkey-ceremony")).toBeNull();
      });
    });

    describe("when the offer is waved away", () => {
      /** @scenario Declining the offer costs nothing */
      it("leaves the confirmation and the way to sign in exactly where they were", async () => {
        await resetSuccessfully();
        fireEvent.click(screen.getByTestId("reset-dismiss-passkey"));

        expect(screen.queryByTestId("post-reset-passkey-offer")).toBeNull();
        expect(
          screen.getByRole("heading", { name: /password updated/i }),
        ).toBeTruthy();
        expect(screen.getByTestId("reset-sign-in")).toBeTruthy();
      });
    });
  });

  describe("given a deployment that does not sign people in with passkeys", () => {
    describe("when the reset completes", () => {
      /** @scenario No passkey is offered where the auth screens cannot take one */
      it("shows the confirmation it always was", async () => {
        publicEnvRef.current = {
          NEXTAUTH_PROVIDER: "email",
          // The plugin is mounted, but the legacy screens are still the way in
          // and they take no passkey — so minting one would be a credential
          // for a door with no button on it.
          IDENTITY_FRONT_DOOR: false,
          PASSKEYS_ENABLED: true,
        };
        await resetSuccessfully();

        expect(screen.queryByTestId("post-reset-passkey-offer")).toBeNull();
        expect(screen.getByTestId("reset-sign-in")).toBeTruthy();
      });
    });
  });
});
