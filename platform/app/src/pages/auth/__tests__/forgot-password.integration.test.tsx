/**
 * @vitest-environment jsdom
 *
 * Integration tests for the /auth/forgot-password page. The full component
 * tree renders under Chakra; only the BetterAuth client (network boundary) and
 * the public-env hook are mocked.
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

const { mockRequestPasswordReset, publicEnvRef } = vi.hoisted(() => ({
  mockRequestPasswordReset: vi.fn(),
  publicEnvRef: {
    current: {
      NEXTAUTH_PROVIDER: "email" as string | undefined,
      HAS_EMAIL_PROVIDER_KEY: true,
    },
  },
}));

vi.mock("~/utils/auth-client", () => ({
  authClient: { requestPasswordReset: mockRequestPasswordReset },
}));

vi.mock("../../../hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
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

import ForgotPassword from "../forgot-password";

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <ForgotPassword />
    </ChakraProvider>,
  );

const submitEmail = (email: string) => {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
};

describe("ForgotPassword page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestPasswordReset.mockResolvedValue({ data: {}, error: null });
    publicEnvRef.current = {
      NEXTAUTH_PROVIDER: "email",
      HAS_EMAIL_PROVIDER_KEY: true,
    };
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the user submits their email in credential mode", () => {
    /** @scenario Requesting a reset submits the entered email to the reset endpoint */
    it("calls requestPasswordReset with the entered email", async () => {
      renderPage();
      submitEmail("forgot@acme.test");

      await waitFor(() => {
        expect(mockRequestPasswordReset).toHaveBeenCalledWith({
          email: "forgot@acme.test",
          redirectTo: "/auth/reset-password",
        });
      });
    });

    /** @scenario Requesting a reset always shows a neutral confirmation */
    it("shows an enumeration-safe confirmation that does not reveal registration", async () => {
      renderPage();
      submitEmail("forgot@acme.test");

      const confirmation = await screen.findByText(/if an account exists for/i);
      expect(confirmation).toBeTruthy();
      expect(confirmation.textContent).toContain("forgot@acme.test");
      // No wording that distinguishes a registered from an unregistered email.
      expect(screen.queryByText(/no account/i)).toBeNull();
      expect(screen.queryByText(/not found/i)).toBeNull();
    });
  });

  describe("when the deployment has no outbound email configured", () => {
    beforeEach(() => {
      publicEnvRef.current = {
        NEXTAUTH_PROVIDER: "email",
        HAS_EMAIL_PROVIDER_KEY: false,
      };
    });

    /** @scenario Password reset does not promise an email nobody can send */
    it("says so instead of offering a form that would promise a link", () => {
      renderPage();

      expect(screen.getByText(/cannot send email/i)).toBeTruthy();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(
        screen.queryByRole("button", { name: /send reset link/i }),
      ).toBeNull();
    });

    it("points at the operator rather than leaving the user with nothing", () => {
      renderPage();

      expect(screen.getByText(/whoever operates it/i)).toBeTruthy();
    });
  });

  describe("when the reset endpoint fails", () => {
    /** @scenario A failure to dispatch the request still shows the neutral confirmation */
    it("still shows the same neutral confirmation and no enumeration-leaking error", async () => {
      mockRequestPasswordReset.mockRejectedValueOnce(new Error("network down"));
      renderPage();
      submitEmail("forgot@acme.test");

      const confirmation = await screen.findByText(/if an account exists for/i);
      expect(confirmation).toBeTruthy();
      expect(screen.queryByText(/error/i)).toBeNull();
    });
  });

  describe("when the deployment uses an SSO identity provider", () => {
    it("explains the password is managed by the provider instead of a form", () => {
      publicEnvRef.current = {
        NEXTAUTH_PROVIDER: "auth0",
        HAS_EMAIL_PROVIDER_KEY: true,
      };
      renderPage();

      expect(
        screen.getByText(/managed by your identity provider/i),
      ).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: /send reset link/i }),
      ).toBeNull();
    });
  });
});
