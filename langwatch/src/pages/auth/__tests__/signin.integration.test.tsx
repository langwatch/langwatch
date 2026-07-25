/**
 * @vitest-environment jsdom
 *
 * Integration tests for /auth/signin: the Forgot-password entry point (the
 * credential form must offer a reset link in email mode, and SSO mode must
 * not render the credential form or the link at all) and the
 * already-authenticated bounce path (an authenticated user hitting this page
 * must be redirected only to a same-origin destination).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSignIn, sessionRef, publicEnvRef, searchParamsRef } = vi.hoisted(
  () => ({
    mockSignIn: vi.fn(),
    sessionRef: { current: { data: null as unknown } },
    publicEnvRef: {
      current: { NEXTAUTH_PROVIDER: "email" as string | undefined },
    },
    searchParamsRef: { current: new URLSearchParams("") },
  }),
);

vi.mock("~/utils/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/auth-client")>();
  return {
    ...actual,
    signIn: mockSignIn,
    useSession: () => sessionRef.current,
  };
});

vi.mock("~/utils/compat/next-navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
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
    searchParamsRef.current = new URLSearchParams("");
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

describe("SignIn already-authenticated redirect", () => {
  let originalLocation: Location;
  let replace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionRef.current = { data: { user: { id: "user-1" } } };
    publicEnvRef.current = { NEXTAUTH_PROVIDER: "email" };

    originalLocation = window.location;
    replace = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, replace },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  describe("given a protocol-relative callbackUrl (@regression: open redirect via //host)", () => {
    it("falls back to the dashboard instead of following it off-domain", async () => {
      searchParamsRef.current = new URLSearchParams(
        "callbackUrl=//evil.example.com",
      );
      renderPage();

      await waitFor(() => {
        expect(replace).toHaveBeenCalledTimes(1);
      });
      expect(replace).toHaveBeenCalledWith("/");
    });
  });

  describe("given a same-origin relative callbackUrl", () => {
    it("preserves it as the redirect destination", async () => {
      searchParamsRef.current = new URLSearchParams(
        "callbackUrl=/settings/members",
      );
      renderPage();

      await waitFor(() => {
        expect(replace).toHaveBeenCalledTimes(1);
      });
      expect(replace).toHaveBeenCalledWith("/settings/members");
    });
  });
});
