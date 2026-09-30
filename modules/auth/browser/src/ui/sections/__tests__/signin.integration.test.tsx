/**
 * @vitest-environment jsdom
 * The sign-in page: a signed-in arrival bounces same-origin only, and a
 * signed-out arrival says so instead of asking for an address.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { routeMock, sessionRef, searchParamsRef, replace } = vi.hoisted(() => ({
  routeMock: vi.fn(),
  sessionRef: { current: { data: null as unknown } },
  searchParamsRef: { current: new URLSearchParams("") },
  replace: vi.fn(),
}));

vi.mock("../../../behavior/auth-client.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof authClientModule>();
  return { ...actual, signIn: vi.fn(), useSession: () => sessionRef.current };
});

vi.mock("../../../behavior/auth-api.ts", () => ({
  authApi: {
    auth: {
      route: { useMutation: () => ({ mutateAsync: routeMock, isPending: false, error: null }) },
      priorSession: { useQuery: () => ({ data: undefined }) },
      requestSignUpVerification: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
      },
    },
  },
}));

// jsdom's `location` cannot be replaced, so the navigation seam is mocked.
vi.mock("../../../behavior/browser-navigation.ts", () => ({
  replaceLocation: replace,
  hardNavigate: vi.fn(),
  reloadPage: vi.fn(),
}));

vi.mock("../../../behavior/use-route.ts", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

vi.mock("../../../behavior/use-public-env.ts", () => ({
  usePublicEnv: () => ({ data: { NEXTAUTH_PROVIDER: "email" } }),
}));

import type * as authClientModule from "../../../behavior/auth-client.tsx";
import SignIn from "../signin-screen.tsx";

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SignIn />
    </ChakraProvider>,
  );

describe("SignIn already-authenticated redirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionRef.current = { data: { user: { id: "user-1" } } };
  });

  afterEach(() => cleanup());

  describe("given a protocol-relative callbackUrl (@regression: open redirect via //host)", () => {
    it("falls back to the dashboard instead of following it off-domain", async () => {
      searchParamsRef.current = new URLSearchParams("callbackUrl=//evil.example.com");
      renderPage();

      await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
      expect(replace).toHaveBeenCalledWith("/");
      expect(routeMock).not.toHaveBeenCalled();
    });
  });

  describe("given a same-origin relative callbackUrl", () => {
    it("preserves it as the redirect destination", async () => {
      searchParamsRef.current = new URLSearchParams("callbackUrl=/settings/members");
      renderPage();

      await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
      expect(replace).toHaveBeenCalledWith("/settings/members");
    });
  });
});

describe("SignIn after signing out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionRef.current = { data: null };
    searchParamsRef.current = new URLSearchParams("signedOut=1");
  });

  afterEach(() => cleanup());

  it("says so and offers the way back in, asking the router nothing", () => {
    renderPage();

    expect(screen.getByText("You’ve signed out of LangWatch.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Log in again" }).getAttribute("href")).toBe(
      "/auth/signin",
    );
    expect(routeMock).not.toHaveBeenCalled();
  });
});
