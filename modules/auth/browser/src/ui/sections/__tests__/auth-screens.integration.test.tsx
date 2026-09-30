/**
 * @vitest-environment jsdom
 *
 * The identifier-first screens are the screens (ADR-117 §7): reset follows the identifier, is
 * refused where the installation holds no passwords, and no journey reaches hosted pages.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { RoutingDecision } from "@langwatch/identity-contract";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  publicEnvRef,
  routeMock,
  requestVerificationMock,
  completeVerificationMock,
  registerMock,
  signInMock,
  requestPasswordResetMock,
  searchParamsRef,
} = vi.hoisted(() => ({
  publicEnvRef: {
    current: {
      NEXTAUTH_PROVIDER: "email",
      HAS_EMAIL_PROVIDER_KEY: true,
    } as Record<string, unknown>,
  },
  routeMock: vi.fn(),
  requestVerificationMock: vi.fn(),
  completeVerificationMock: vi.fn(),
  registerMock: vi.fn(),
  signInMock: vi.fn(),
  requestPasswordResetMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams("") },
}));

vi.mock("../../../behavior/use-public-env.ts", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

vi.mock("../../../behavior/auth-api.ts", () => ({
  authApi: {
    auth: {
      route: {
        useMutation: () => ({
          mutateAsync: routeMock,
          isPending: false,
          error: null,
        }),
      },
      requestSignUpVerification: {
        useMutation: () => ({
          mutateAsync: requestVerificationMock,
          isPending: false,
          error: null,
        }),
      },
      completeSignUpVerification: {
        useMutation: () => ({
          mutateAsync: completeVerificationMock,
          isPending: false,
          error: null,
        }),
      },
      sendMyAddressConfirmation: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
          error: null,
        }),
      },
      signUpEnrollment: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
      },
      priorSession: {
        useQuery: () => ({ data: undefined }),
      },
    },
    user: {
      register: {
        useMutation: () => ({
          mutateAsync: registerMock,
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

vi.mock("../../../behavior/auth-client.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof authClientModule>();
  return {
    ...actual,
    signIn: signInMock,
    useSession: () => ({ data: null }),
    authClient: { requestPasswordReset: requestPasswordResetMock },
  };
});

vi.mock("../../../behavior/browser-navigation.ts", () => ({
  replaceLocation: vi.fn(),
  hardNavigate: vi.fn(),
  reloadPage: vi.fn(),
}));

vi.mock("../../../behavior/use-route.ts", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

import type * as authClientModule from "../../../behavior/auth-client.tsx";
import ForgotPassword from "../forgot-password-screen.tsx";
import SignIn from "../signin-screen.tsx";
import SignUp from "../signup-screen.tsx";

const federatedPicker: RoutingDecision = {
  outcome: "method_picker",
  methodSet: [
    { id: "password", kind: "password", connectionId: null },
    { id: "auth0", kind: "federated", connectionId: "env:auth0" },
  ],
  reasonCode: "no_domain_match",
};

const renderPage = (page: ReactNode) =>
  render(<ChakraProvider value={defaultSystem}>{page}</ChakraProvider>);

describe("given the identifier-first screens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsRef.current = new URLSearchParams("");
    publicEnvRef.current = {
      NEXTAUTH_PROVIDER: "auth0",
      HAS_EMAIL_PROVIDER_KEY: true,
    };
    routeMock.mockResolvedValue(federatedPicker);
    requestPasswordResetMock.mockResolvedValue({});
  });

  afterEach(() => cleanup());

  describe("when somebody who holds a password asks to reset it", () => {
    /** @scenario Reset follows the identifier, not the deployment mode */
    /** @scenario "Password reset follows the identifier" */
    it("offers the reset on a deployment that signs in through a provider", async () => {
      publicEnvRef.current = {
        ...publicEnvRef.current,
        IS_SAAS: false,
      };
      const { container } = renderPage(<ForgotPassword />);

      expect(container.querySelector('input[type="email"]')).not.toBeNull();
      expect(screen.queryByText(/password is managed by your identity provider/i)).toBeNull();

      await userEvent.type(container.querySelector('input[type="email"]')!, "sam@acme.com");
      await userEvent.click(screen.getByRole("button", { name: /send reset link/i }));

      // The same neutral sentence either way: the screen never learns, and
      // never says, whether the address has an account or holds a password.
      expect(await screen.findByText(/if an account exists for/i)).toBeTruthy();
      expect(requestPasswordResetMock).toHaveBeenCalledWith({
        email: "sam@acme.com",
        redirectTo: "/auth/reset-password",
      });
    });

    /** @scenario Password reset is offered only where passwords can be reset */
    it("still says so where the installation holds no passwords at all", () => {
      publicEnvRef.current = {
        ...publicEnvRef.current,
        IS_SAAS: true,
      };

      const { container } = renderPage(<ForgotPassword />);

      expect(screen.getByText(/password is managed by your identity provider/i)).toBeTruthy();
      expect(container.querySelector('input[type="email"]')).toBeNull();
    });
  });

  describe("when every unauthenticated journey through the new screens is walked", () => {
    // An identity provider is reached by dialling it from our own origin,
    // never by rendering its page.
    /** @scenario No unauthenticated journey touches an Auth0-hosted page */
    it("renders no page, asset or link that resolves to a hosted provider page", async () => {
      const journeys: ReactNode[] = [<SignIn key="in" />, <SignUp key="up" />];

      for (const journey of journeys) {
        const { container, unmount } = renderPage(journey);
        await screen.findByRole("button", { name: /^continue$/i });
        expectNothingHosted(container);
        unmount();
      }

      // The picker for an address that routes nowhere: it offers the provider
      // as a method, and offering it must still not put a hosted page in
      // reach.
      const { container } = renderPage(<SignIn />);
      await userEvent.type(await screen.findByLabelText(/email/i), "sam@acme.com");
      await userEvent.click(screen.getByRole("button", { name: /^continue$/i }));
      await screen.findByTestId("method-picker");
      expectNothingHosted(container);

      await userEvent.click(screen.getByRole("button", { name: /continue with single sign-on/i }));
      await waitFor(() => {
        expect(signInMock).toHaveBeenCalledWith("auth0", {
          callbackUrl: undefined,
          loginHint: "sam@acme.com",
        });
      });
    });
  });
});

/**
 * Nothing rendered names a host at all: every link is same-origin, and no
 * asset or attribute mentions a provider's hosted domain.
 */
function expectNothingHosted(container: HTMLElement): void {
  // biome-ignore-start lint/suspicious/noMisplacedAssertion: nothing hosted
  // elsewhere, asserted whole, for every journey that has to satisfy it.
  expect(container.innerHTML).not.toMatch(/auth0\.com|\.auth0\.|okta\.com/i);

  for (const anchor of container.querySelectorAll("a[href]")) {
    expect(anchor.getAttribute("href")).toMatch(/^\/(?!\/)/);
  }
  for (const sourced of container.querySelectorAll("[src]")) {
    const src = sourced.getAttribute("src") ?? "";
    expect(src).not.toMatch(/^https?:\/\//);
  }
  // biome-ignore-end lint/suspicious/noMisplacedAssertion: end of the shared sweep
}
