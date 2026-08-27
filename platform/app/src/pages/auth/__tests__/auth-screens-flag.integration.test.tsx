/**
 * @vitest-environment jsdom
 *
 * One flag covers the router and the screens (ADR-117 §7). These tests hold
 * both sides of it: enforced, the first-party screens answer and no journey
 * through them reaches an identity provider's hosted pages; not enforced, the
 * legacy screens answer exactly as they did before, which is what makes the
 * rollback a flag rather than a deploy.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { RoutingDecision } from "@langwatch/identity";
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
      IDENTITY_FRONT_DOOR: false,
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

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

vi.mock("~/utils/api", () => ({
  api: {
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

vi.mock("~/utils/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/auth-client")>();
  return {
    ...actual,
    signIn: signInMock,
    useSession: () => ({ data: null }),
    authClient: { requestPasswordReset: requestPasswordResetMock },
  };
});

vi.mock("~/utils/browserNavigation", () => ({
  replaceLocation: vi.fn(),
  hardNavigate: vi.fn(),
  reloadPage: vi.fn(),
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

import ForgotPassword from "../forgot-password";
import SignIn from "../signin";
import SignUp from "../signup";

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

describe("given the identifier-first auth screens is not enforced", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsRef.current = new URLSearchParams("");
    publicEnvRef.current = {
      NEXTAUTH_PROVIDER: "email",
      IDENTITY_FRONT_DOOR: false,
      HAS_EMAIL_PROVIDER_KEY: true,
    };
    routeMock.mockResolvedValue(federatedPicker);
  });

  afterEach(() => cleanup());

  describe("when the sign-in page is requested", () => {
    /** @scenario The legacy screens return untouched when the flag is off */
    it("answers with the legacy screen and asks the router nothing", async () => {
      const { container } = renderPage(<SignIn />);

      // The legacy credential screen: one form carrying both fields, which is
      // exactly what it rendered before any of this existed.
      expect(container.querySelector('input[type="email"]')).not.toBeNull();
      expect(container.querySelector('input[type="password"]')).not.toBeNull();
      expect(
        screen.getByRole("link", { name: /forgot password/i }),
      ).toBeTruthy();
      expect(screen.queryByTestId("method-picker")).toBeNull();
      expect(routeMock).not.toHaveBeenCalled();
    });
  });

  describe("when the sign-up page is requested", () => {
    /** @scenario The legacy screens return untouched when the flag is off */
    it("answers with the legacy screen, which asks for a password up front", () => {
      const { container } = renderPage(<SignUp />);

      expect(container.querySelectorAll('input[type="password"]').length).toBe(
        2,
      );
      expect(screen.getByRole("button", { name: /sign up/i })).toBeTruthy();
      expect(requestVerificationMock).not.toHaveBeenCalled();
    });
  });

  describe("when the deployment signs in through an identity provider", () => {
    /** @scenario The legacy screens return untouched when the flag is off */
    /** @scenario Password reset stays a credential-mode concept before the flip */
    it("keeps refusing password reset, as it did before", () => {
      publicEnvRef.current = {
        NEXTAUTH_PROVIDER: "auth0",
        IDENTITY_FRONT_DOOR: false,
        HAS_EMAIL_PROVIDER_KEY: true,
      };

      const { container } = renderPage(<ForgotPassword />);

      expect(
        screen.getByText(/password is managed by your identity provider/i),
      ).toBeTruthy();
      expect(container.querySelector('input[type="email"]')).toBeNull();
    });
  });
});

describe("given the identifier-first auth screens is enforced", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsRef.current = new URLSearchParams("");
    publicEnvRef.current = {
      NEXTAUTH_PROVIDER: "auth0",
      IDENTITY_FRONT_DOOR: true,
      HAS_EMAIL_PROVIDER_KEY: true,
    };
    routeMock.mockResolvedValue(federatedPicker);
    requestPasswordResetMock.mockResolvedValue({});
  });

  afterEach(() => cleanup());

  describe("when somebody who holds a password asks to reset it", () => {
    /** @scenario Reset follows the identifier, not the deployment mode */
    /** @scenario Password reset follows the identifier once the auth screens is enforced */
    it("offers the reset on a deployment that signs in through a provider", async () => {
      publicEnvRef.current = {
        ...publicEnvRef.current,
        IS_SAAS: false,
      };
      const { container } = renderPage(<ForgotPassword />);

      expect(container.querySelector('input[type="email"]')).not.toBeNull();
      expect(
        screen.queryByText(/password is managed by your identity provider/i),
      ).toBeNull();

      await userEvent.type(
        container.querySelector('input[type="email"]')!,
        "sam@acme.com",
      );
      await userEvent.click(
        screen.getByRole("button", { name: /send reset link/i }),
      );

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

      expect(
        screen.getByText(/password is managed by your identity provider/i),
      ).toBeTruthy();
      expect(container.querySelector('input[type="email"]')).toBeNull();
    });
  });

  describe("when every unauthenticated journey through the new screens is walked", () => {
    /*
     * Scoped to the enforced screens on purpose: the legacy path still exists
     * until the bake ends, and it still auto-redirects to whatever provider
     * the deployment names. What this pins is that nothing a person touches on
     * the NEW journeys is hosted anywhere but here: an identity provider is
     * reached by dialling it from our own origin, never by rendering its page.
     */
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
      await userEvent.type(
        await screen.findByLabelText(/email/i),
        "sam@acme.com",
      );
      await userEvent.click(
        screen.getByRole("button", { name: /^continue$/i }),
      );
      await screen.findByTestId("method-picker");
      expectNothingHosted(container);

      await userEvent.click(
        screen.getByRole("button", { name: /continue with single sign-on/i }),
      );
      await waitFor(() => {
        expect(signInMock).toHaveBeenCalledWith("auth0", {
          callbackUrl: undefined,
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
  // biome-ignore-start lint/suspicious/noMisplacedAssertion: one shape of "nothing here is hosted elsewhere", asserted whole, for every journey that has to satisfy it
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
