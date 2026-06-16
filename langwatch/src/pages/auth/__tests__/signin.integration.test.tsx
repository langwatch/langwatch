/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Forgot-password entry point on /auth/signin. The
 * credential form must offer a reset link in email mode, and SSO mode must not
 * render the credential form (or the link) at all.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSignIn, sessionRef, publicEnvRef } = vi.hoisted(() => ({
  mockSignIn: vi.fn(),
  sessionRef: { current: { data: null as unknown } },
  publicEnvRef: {
    current: { NEXTAUTH_PROVIDER: "email" as string | undefined },
  },
}));

vi.mock("~/utils/auth-client", () => ({
  signIn: mockSignIn,
  useSession: () => sessionRef.current,
}));

vi.mock("~/utils/compat/next-navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
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

import SignIn from "../signin";

const renderPage = () => {
  const view = render(
    <ChakraProvider value={defaultSystem}>
      <SignIn />
    </ChakraProvider>,
  );
  return view;
};

describe("SignIn forgot-password entry point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionRef.current = { data: null };
    publicEnvRef.current = { NEXTAUTH_PROVIDER: "email" };
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the deployment uses credential (email) mode", () => {
    /** @scenario The credential sign-in form shows a Forgot password link */
    it("renders the email/password form with a link to forgot-password", () => {
      const { container } = renderPage();

      expect(container.querySelector('input[type="email"]')).not.toBeNull();
      expect(container.querySelector('input[type="password"]')).not.toBeNull();
      const link = screen.getByRole("link", { name: /forgot password/i });
      expect(link.getAttribute("href")).toBe("/auth/forgot-password");
    });
  });

  describe("when the deployment uses an SSO identity provider", () => {
    /** @scenario SSO sign-in renders no credential form and no Forgot password link */
    it("renders no credential form and no forgot-password link", () => {
      publicEnvRef.current = { NEXTAUTH_PROVIDER: "auth0" };
      const { container } = renderPage();

      expect(container.querySelector('input[type="email"]')).toBeNull();
      expect(container.querySelector('input[type="password"]')).toBeNull();
      expect(
        screen.queryByRole("link", { name: /forgot password/i }),
      ).toBeNull();
    });
  });
});
