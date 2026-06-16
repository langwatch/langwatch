/**
 * @vitest-environment jsdom
 *
 * Integration tests for the /auth/reset-password page. The full component tree
 * renders under Chakra; only the BetterAuth client and the URL search-params
 * hook are mocked.
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

const { mockResetPassword, searchParamsRef } = vi.hoisted(() => ({
  mockResetPassword: vi.fn(),
  searchParamsRef: {
    current: new URLSearchParams("token=tok_valid") as URLSearchParams | null,
  },
}));

vi.mock("~/utils/auth-client", () => ({
  authClient: { resetPassword: mockResetPassword },
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

const renderPage = () => {
  const view = render(
    <ChakraProvider value={defaultSystem}>
      <ResetPassword />
    </ChakraProvider>,
  );
  return view;
};

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

describe("ResetPassword page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetPassword.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    setToken("tok_valid");
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
        await screen.findByText(/your password has been reset/i),
      ).toBeTruthy();
      const signInLink = screen.getByRole("link", { name: /sign in/i });
      expect(signInLink.getAttribute("href")).toBe("/auth/signin");
    });
  });

  describe("when the new password is shorter than 8 characters", () => {
    /** @scenario The reset form rejects passwords shorter than 8 characters */
    it("shows a length validation error and does not call the reset endpoint", async () => {
      const { container } = renderPage();
      fillAndSubmit({ container, password: "short", confirm: "short" });

      // Both fields are too short, so the message renders for each.
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

      expect(await screen.findByText(/invalid or has expired/i)).toBeTruthy();
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

      expect(
        screen.getByRole("heading", { name: /invalid reset link/i }),
      ).toBeTruthy();
      expect(
        screen.getByRole("link", { name: /request a new reset link/i }),
      ).toBeTruthy();
      // No password form is rendered without a token.
      expect(passwordInputs(container)).toHaveLength(0);
    });
  });
});
