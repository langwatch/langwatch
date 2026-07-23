/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the already-signed-in bounce path on /auth/signin.
 * A prior version redirected via a raw `callbackUrl.startsWith("/")` check,
 * which a protocol-relative value like `//evil.com` satisfies while the
 * browser still treats it as an off-domain redirect (open redirect).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSignIn, safeRedirectTargetImpl, sessionRef, publicEnvRef } =
  vi.hoisted(() => ({
    mockSignIn: vi.fn(),
    safeRedirectTargetImpl: (callbackUrl: string | undefined): string => {
      if (!callbackUrl) return "/";
      if (callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")) {
        return callbackUrl;
      }
      return "/";
    },
    sessionRef: { current: { data: null as unknown } },
    publicEnvRef: {
      current: { NEXTAUTH_PROVIDER: "email" as string | undefined },
    },
  }));

vi.mock("~/utils/auth-client", () => ({
  signIn: mockSignIn,
  useSession: () => sessionRef.current,
  safeRedirectTarget: safeRedirectTargetImpl,
}));

let searchParams = new URLSearchParams("");
vi.mock("~/utils/compat/next-navigation", () => ({
  useSearchParams: () => searchParams,
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
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import SignIn from "../signin";

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SignIn />
    </ChakraProvider>,
  );

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

  /** @scenario A protocol-relative callbackUrl never reaches window.location.replace */
  it("rejects a protocol-relative callbackUrl and falls back to the dashboard", async () => {
    searchParams = new URLSearchParams("callbackUrl=//evil.example.com");
    renderPage();

    await waitFor(() => {
      expect(replace).toHaveBeenCalledTimes(1);
    });
    expect(replace).toHaveBeenCalledWith("/");
  });

  /** @scenario A same-origin relative callbackUrl is preserved */
  it("preserves a same-origin relative callbackUrl", async () => {
    searchParams = new URLSearchParams("callbackUrl=/settings/members");
    renderPage();

    await waitFor(() => {
      expect(replace).toHaveBeenCalledTimes(1);
    });
    expect(replace).toHaveBeenCalledWith("/settings/members");
  });
});
