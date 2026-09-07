/**
 * @vitest-environment jsdom
 *
 * Sign-up (D13, ADR-117 §6): the address is asked for and confirmed before a
 * password or passkey can be created. The emailed link returns the single-use
 * proof that binds the eventual credential to that address.
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
  requestVerificationMock,
  enrollmentMock,
  completeVerificationMock,
  sendConfirmationMock,
  routeMock,
  registerMock,
  signInMock,
  addPasskeyMock,
  navigateMock,
  hardRedirectMock,
  searchParamsRef,
  publicEnvRef,
} = vi.hoisted(() => ({
  requestVerificationMock: vi.fn(),
  enrollmentMock: vi.fn(),
  completeVerificationMock: vi.fn(),
  sendConfirmationMock: vi.fn(),
  routeMock: vi.fn(),
  registerMock: vi.fn(),
  signInMock: vi.fn(),
  addPasskeyMock: vi.fn(),
  navigateMock: vi.fn(),
  hardRedirectMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams("") },
  publicEnvRef: { current: { IS_SAAS: true } as Record<string, unknown> },
}));

/**
 * A mutation that behaves the way the screen depends on react-query behaving:
 * a rejected call leaves an `error` on the hook and re-renders, which is what
 * turns an expired link into the state that offers a fresh one.
 */
vi.mock("~/utils/api", async () => {
  const { useCallback, useState } = await import("react");
  const useFakeMutation = (run: (input: never) => Promise<unknown>) => () => {
    const [error, setError] = useState<unknown>(null);
    const [isPending, setIsPending] = useState(false);
    const mutateAsync = useCallback(async (input: never) => {
      setIsPending(true);
      try {
        const result = await run(input);
        setError(null);
        return result;
      } catch (failure) {
        setError(failure);
        throw failure;
      } finally {
        setIsPending(false);
      }
    }, []);
    // `mutate` is the fire-and-forget half of the same call: it never
    // rejects, which is exactly why the send-confirmation path uses it.
    const mutate = useCallback(
      (input: never) => {
        void mutateAsync(input).catch(() => undefined);
      },
      [mutateAsync],
    );
    return { mutate, mutateAsync, isPending, error };
  };

  return {
    api: {
      auth: {
        route: { useMutation: useFakeMutation(routeMock) },
        requestSignUpVerification: {
          useMutation: useFakeMutation(requestVerificationMock),
        },
        signUpEnrollment: { useMutation: useFakeMutation(enrollmentMock) },
        sendMyAddressConfirmation: {
          useMutation: useFakeMutation(sendConfirmationMock),
        },
      },
      user: { register: { useMutation: useFakeMutation(registerMock) } },
    },
  };
});

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

// The link is spent against the better-auth endpoint, not a tRPC procedure,
// because the spend can open a session. Mocked at the module that wraps the
// fetch, so a rejection is the REST body the screen reads through the
// registry.
vi.mock("~/features/auth/logic/confirmSignUpAddress", () => ({
  confirmSignUpAddress: (...args: unknown[]) =>
    completeVerificationMock(...args),
}));

// A link that signed the person in leaves the page for the app. Spied rather
// than let loose on jsdom's location.
vi.mock("~/utils/hardRedirect", () => ({
  hardRedirect: (...args: unknown[]) => hardRedirectMock(...args),
}));

vi.mock("~/utils/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/auth-client")>();
  return {
    ...actual,
    signIn: signInMock,
    navigate: navigateMock,
    useSession: () => ({ data: null }),
    authClient: {
      ...actual.authClient,
      passkey: { addPasskey: addPasskeyMock },
    },
  };
});

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

import { VerificationFirstSignUp } from "../VerificationFirstSignUp";

const localPicker: RoutingDecision = {
  outcome: "method_picker",
  methodSet: [{ id: "password", kind: "password", connectionId: null }],
  reasonCode: "no_domain_match",
};

const unknownIdentifier: RoutingDecision = {
  outcome: "route_to_signup",
  methodSet: [],
  reasonCode: "identifier_unknown",
};

// The REST body a refused spend answers with — the flat shape a Hono route
// sends, which is what the better-auth endpoint answers a handled error in.
const expiredLink = {
  error: "identity_verification_expired",
  message: "identity_verification_expired",
  fault: "customer",
  status: 410,
};

/**
 * Types the same password into both boxes.
 *
 * Two steps, because the second box is not on the screen yet: the credential
 * step opens with one field, and the confirmation and the submit arrive once
 * somebody starts using it. Re-querying after the first is what proves that —
 * a single up-front `querySelectorAll` would have found one element and this
 * helper exists so every caller notices.
 */
const fillPasswordPair = async (container: HTMLElement, password: string) => {
  const first = container.querySelector('input[type="password"]');
  await userEvent.type(first as HTMLInputElement, password);

  const both = container.querySelectorAll('input[type="password"]');
  await userEvent.type(both[1] as HTMLInputElement, password);
};

const renderScreen = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <VerificationFirstSignUp />
    </ChakraProvider>,
  );

describe("given the sign-up screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsRef.current = new URLSearchParams("");
    publicEnvRef.current = { IS_SAAS: true };
    requestVerificationMock.mockResolvedValue({ sent: true });
    enrollmentMock.mockResolvedValue({
      outcome: "enroll",
      methodSet: [{ id: "password", kind: "password", connectionId: null }],
      reasonCode: "identifier_unknown",
    });
    routeMock.mockImplementation(
      ({ identifier }: { identifier: string | null }) =>
        Promise.resolve(identifier === null ? localPicker : unknownIdentifier),
    );
  });

  afterEach(() => cleanup());

  describe("when sign-up starts with a work address", () => {
    /** @scenario Sign-up proves the address before asking for a credential */
    it("sends a confirmation and draws no credential controls", async () => {
      const { container } = renderScreen();

      await userEvent.type(
        await screen.findByLabelText(/email/i),
        "sam@acme.com",
      );
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      expect(await screen.findByTestId("verification-sent")).toHaveTextContent(
        /sam@acme\.com/,
      );
      expect(requestVerificationMock).toHaveBeenCalledWith({
        email: "sam@acme.com",
      });
      expect(registerMock).not.toHaveBeenCalled();
      expect(container.querySelector('input[type="password"]')).toBeNull();
      expect(screen.queryByTestId("passkey-sign-up")).toBeNull();
    });

    /** @scenario Password registration consumes the proof exactly once */
    it("creates and signs in only after the proof returns", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof_1",
        signedIn: false,
      });
      registerMock.mockResolvedValue({ id: "user_1" });
      signInMock.mockResolvedValue({ data: { user: { id: "user_1" } } });

      const { container } = renderScreen();
      await screen.findByTestId("verified-address");

      await fillPasswordPair(container, "a-good-password");
      await userEvent.click(
        screen.getByRole("button", { name: "Create account" }),
      );

      await waitFor(() => {
        expect(registerMock).toHaveBeenCalledWith(
          expect.objectContaining({
            email: "sam@acme.com",
            password: "a-good-password",
            addressProof: "proof_1",
          }),
        );
      });
      // No name is asked for: onboarding does that.
      expect(registerMock.mock.calls[0]?.[0]).not.toHaveProperty("name");

      expect(signInMock).toHaveBeenCalled();
      expect(sendConfirmationMock).not.toHaveBeenCalled();
      expect(requestVerificationMock).not.toHaveBeenCalled();
    });
  });

  describe("when a confirmation link comes back for an account that exists", () => {
    /** @scenario A confirmation link for an existing account signs it in */
    it("goes straight into the app on the session the link opened", async () => {
      searchParamsRef.current = new URLSearchParams(
        "verify=a-token&callbackUrl=%2Fprojects",
      );
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: true,
        addressProof: null,
        signedIn: true,
      });

      renderScreen();

      expect(await screen.findByTestId("signed-in-handoff")).toHaveTextContent(
        /sam@acme\.com/,
      );
      // The link IS the sign-in. Nothing is asked — not a password for the
      // account they just made, and not a picker that reads a projection
      // which may not have caught up with the account yet.
      expect(hardRedirectMock).toHaveBeenCalledWith("/projects");
      expect(screen.queryByTestId("method-picker")).toBeNull();
      expect(routeMock).not.toHaveBeenCalled();
    });

    /** @scenario Reopening a consumed link offers fresh-link recovery */
    it("offers the way in when the link was reopened and opened no session", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: true,
        addressProof: null,
        signedIn: false,
      });

      renderScreen();

      expect(await screen.findByTestId("account-ready")).toHaveTextContent(
        /sam@acme\.com/,
      );
      // One link is one way in. Reopened inside its grace window it confirms
      // again but opens no second session, so the way in has to be on this
      // card: the routed picker rather than a password box, because the
      // credential this account holds may be a passkey.
      expect(await screen.findByTestId("method-picker")).toBeTruthy();
      expect(screen.queryByTestId("passkey-sign-up")).toBeNull();
      expect(hardRedirectMock).not.toHaveBeenCalled();
    });
  });

  describe("when a confirmation link comes back with no account behind it", () => {
    /** @scenario Post-link routing still governs credential enrollment */
    it("offers the method choice through the same picker sign-in renders", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof_1",
        signedIn: false,
      });

      const { container } = renderScreen();

      expect(await screen.findByTestId("verified-address")).toHaveTextContent(
        /sam@acme\.com/,
      );
      expect(await screen.findByTestId("method-picker")).toBeTruthy();
      await waitFor(() => {
        expect(
          container.querySelector('input[type="password"]'),
        ).not.toBeNull();
      });
      expect(enrollmentMock).toHaveBeenCalledWith({
        email: "sam@acme.com",
        addressProof: "proof_1",
      });
      expect(routeMock).not.toHaveBeenCalled();
    });

    it("offers a fresh link when a replay returns no usable proof", async () => {
      searchParamsRef.current = new URLSearchParams("verify=spent-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: null,
        signedIn: false,
      });

      const { container } = renderScreen();

      expect(
        await screen.findByRole("button", { name: /send a new link/i }),
      ).toBeTruthy();
      expect(container.querySelector('input[type="password"]')).toBeNull();
      expect(screen.queryByTestId("passkey-sign-up")).toBeNull();
      expect(routeMock).not.toHaveBeenCalled();
    });

    it("keeps credentials hidden while post-link routing is unavailable", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof_1",
        signedIn: false,
      });
      enrollmentMock.mockRejectedValue(new Error("routing is down"));

      const { container } = renderScreen();

      expect(
        await screen.findByRole("button", { name: /try again/i }),
      ).toBeTruthy();
      expect(container.querySelector('input[type="password"]')).toBeNull();
      expect(screen.queryByTestId("passkey-sign-up")).toBeNull();
    });

    it("hands off to SSO when domain policy changed before the link returned", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof_1",
        signedIn: false,
      });
      routeMock.mockResolvedValue({
        outcome: "redirect_to_connection",
        connectionId: "conn_acme",
        methodSet: [
          { id: "okta", kind: "federated", connectionId: "conn_acme" },
        ],
        reasonCode: "domain_routed",
      } satisfies RoutingDecision);
      enrollmentMock.mockResolvedValue({
        outcome: "redirect",
        methodSet: [
          { id: "okta", kind: "federated", connectionId: "conn_acme" },
        ],
        reasonCode: "domain_routed",
      });

      const { container } = renderScreen();

      await waitFor(() => {
        expect(signInMock).toHaveBeenCalledWith(
          "okta",
          expect.objectContaining({ callbackUrl: "/auth/join" }),
        );
      });
      expect(container.querySelector('input[type="password"]')).toBeNull();
      expect(screen.queryByTestId("passkey-sign-up")).toBeNull();
    });
  });

  describe("when the confirmation link has expired", () => {
    /** @scenario An expired verification link offers a resend, nothing else */
    it("says the link expired, offers a fresh one, and confirms nothing", async () => {
      searchParamsRef.current = new URLSearchParams("verify=stale-token");
      completeVerificationMock.mockRejectedValue(expiredLink);

      const { container } = renderScreen();

      expect(
        await screen.findByText(/that verification link has expired/i),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: /send a new link/i }),
      ).toBeTruthy();

      // Nothing was confirmed: no address is held, no method is offered, and
      // the token was spent exactly once against the server.
      expect(screen.queryByTestId("verified-address")).toBeNull();
      expect(screen.queryByTestId("method-picker")).toBeNull();
      expect(container.querySelector('input[type="password"]')).toBeNull();
      expect(completeVerificationMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the address already has an account", () => {
    /** @scenario Sign-up with an address that already has an account becomes a log-in */
    it("turns into the log-in step with the address already in it", async () => {
      routeMock.mockResolvedValue(localPicker);
      requestVerificationMock.mockRejectedValue({
        data: {
          error: {
            code: "email_already_registered",
            httpStatus: 409,
            fault: "customer",
          },
        },
      });

      const { container } = renderScreen();

      await userEvent.type(
        await screen.findByLabelText(/email/i),
        "sam@acme.com",
      );
      await userEvent.click(
        screen.getByRole("button", { name: /^continue$/i }),
      );
      // The page quietly becomes the log-in step: same address, same methods,
      // and the door back into a half-created account beside it.
      expect(await screen.findByTestId("method-picker")).toBeTruthy();
      expect(screen.getByTestId("routed-identifier")).toHaveTextContent(
        "sam@acme.com",
      );
      expect(screen.getByRole("button", { name: /^log in$/i })).toBeTruthy();
      expect(
        screen.getByRole("link", { name: /forgot password/i }),
      ).toBeTruthy();
      expect(container.querySelector('input[type="email"]')).toBeNull();
      expect(screen.queryByTestId("verification-sent")).toBeNull();
      expect(registerMock).not.toHaveBeenCalled();

      // Nothing anywhere says an account exists, and nothing reads as a
      // refusal: no alert, no notice, no wording about the address.
      expect(container.textContent).not.toMatch(/already (have|has)/i);
      expect(container.textContent).not.toMatch(/registered|exists/i);
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });
  });

  describe("when the router cannot answer at all", () => {
    it("stops rather than offering a password on an address it never checked", async () => {
      // The routing check is what stands between somebody at an
      // SSO-enforced company and a password account on that domain — the one
      // thing the connection exists to prevent. `decide` swallows every
      // failure and answers null, so falling through on a null was the same
      // as deciding "no connection" without asking. A routing outage does it,
      // and so does spending the per-address budget from a shared office
      // network, which is the ordinary case.
      routeMock.mockRejectedValue(new Error("routing is down"));

      const { container } = renderScreen();

      await userEvent.type(
        await screen.findByLabelText(/email/i),
        "sam@acme.com",
      );
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      // No credential step, because nothing said this address may hold one.
      expect(screen.queryByTestId("signup-identifier")).toBeNull();
      expect(container.querySelector('input[type="password"]')).toBeNull();
      // And the reason is on screen rather than swallowed, so the person
      // knows to try again instead of staring at a form that did nothing.
      expect(
        await screen.findByText(/couldn't check how you sign in/i),
      ).toBeVisible();
    });
  });

  describe("when a field the server rejects comes back", () => {
    /** @scenario Sign-up hands a single-sign-on domain to its provider */
    it("hands a routed domain to its provider instead of asking for a credential", async () => {
      routeMock.mockResolvedValue({
        outcome: "redirect_to_connection",
        connectionId: "conn_acme",
        methodSet: [
          { id: "okta", kind: "federated", connectionId: "conn_acme" },
        ],
        reasonCode: "domain_routed",
      } satisfies RoutingDecision);

      const { container } = renderScreen();

      await userEvent.type(
        await screen.findByLabelText(/email/i),
        "sam@acme.com",
      );
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      // Handed on: the screen names the provider rather than the address it
      // would have collected a credential for.
      await screen.findByTestId("routed-to-connection");

      // The account is made at the provider. A password box here would be a
      // way to create the exact thing the connection exists to prevent, so
      // the credential step is never reached for this address.
      expect(screen.queryByTestId("signup-identifier")).toBeNull();
      expect(container.querySelector('input[type="password"]')).toBeNull();
      expect(screen.queryByTestId("passkey-sign-up")).toBeNull();
      expect(registerMock).not.toHaveBeenCalled();
    });

    /** @scenario A rejected field says what to fix, next to the field */
    it("puts the complaint on the field that caused it", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof_1",
        signedIn: false,
      });
      registerMock.mockRejectedValue({
        data: {
          error: {
            code: "validation_error",
            httpStatus: 422,
            fault: "customer",
            meta: {
              fieldErrors: {
                password: ["use at least 8 characters"],
              },
            },
          },
        },
      });

      renderScreen();
      await screen.findByTestId("method-picker");

      await userEvent.type(screen.getByLabelText(/^password$/i), "shortish");
      await userEvent.type(
        screen.getByLabelText(/confirm password/i),
        "shortish",
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Create account" }),
      );

      expect(
        await screen.findByText(/use at least 8 characters/i),
      ).toBeTruthy();
      expect(signInMock).not.toHaveBeenCalled();
    });

    /** @scenario "Mismatched passwords say so" */
    it("says the two passwords are not the same, on the field that differs", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof_1",
        signedIn: false,
      });

      renderScreen();
      await screen.findByTestId("method-picker");

      await userEvent.type(
        screen.getByLabelText(/^password$/i),
        "a-long-enough-password",
      );
      await userEvent.type(
        screen.getByLabelText(/confirm password/i),
        "a-different-password",
      );
      await userEvent.tab();

      expect(
        await screen.findByText(/the two passwords are not the same/i),
      ).toBeTruthy();
      expect(registerMock).not.toHaveBeenCalled();
    });

    /** @scenario A rejected field says what to fix, next to the field */
    it("says what to fix on blur, before the server is asked at all", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof_1",
        signedIn: false,
      });

      renderScreen();
      await screen.findByTestId("method-picker");

      await userEvent.type(screen.getByLabelText(/^password$/i), "short");
      await userEvent.tab();

      expect(
        await screen.findByText(/use at least 8 characters/i),
      ).toBeTruthy();
      expect(registerMock).not.toHaveBeenCalled();
    });
  });

  describe("when the account creation fields are filled by a password manager", () => {
    /** @scenario The address and password fields cooperate with password managers */
    it("names the address and asks for a new password, both the way a manager expects", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof_1",
        signedIn: false,
      });

      const { container } = renderScreen();
      await screen.findByTestId("method-picker");

      const carriedEmail = container.querySelector('input[name="email"]');
      expect(carriedEmail?.getAttribute("value")).toBe("sam@acme.com");
      expect(carriedEmail?.getAttribute("autocomplete")).toBe("username");

      for (const field of container.querySelectorAll(
        'input[type="password"]',
      )) {
        expect(field.getAttribute("autocomplete")).toBe("new-password");
      }
    });
  });

  describe("when the deployment offers passkeys", () => {
    /** Reaches the credential step through an address-confirmation link. */
    const reachCredentialStep = async () => {
      const signupPolicy: RoutingDecision = {
        outcome: "method_picker",
        methodSet: [
          { id: "passkey", kind: "passkey", connectionId: null },
          { id: "password", kind: "password", connectionId: null },
        ],
        reasonCode: "no_domain_match",
      };
      enrollmentMock.mockResolvedValue({
        outcome: "enroll",
        methodSet: signupPolicy.methodSet,
        reasonCode: "identifier_unknown",
      });
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof_1",
        signedIn: false,
      });
      const rendered = renderScreen();
      await screen.findByTestId("verified-address");
      return rendered;
    };

    beforeEach(() => {
      publicEnvRef.current = { IS_SAAS: true };
    });

    it("offers a passkey as well as a password, not instead of one", async () => {
      const { container } = await reachCredentialStep();

      expect(await screen.findByTestId("passkey-sign-up")).toBeTruthy();
      await waitFor(() => {
        expect(
          container.querySelector('input[type="password"]'),
        ).not.toBeNull();
      });
    });

    it("carries the typed address into the ceremony", async () => {
      addPasskeyMock.mockResolvedValue({ data: { id: "passkey_1" } });
      await reachCredentialStep();

      await userEvent.click(screen.getByTestId("passkey-sign-up"));

      await waitFor(() => {
        expect(addPasskeyMock).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.stringContaining('"email":"sam@acme.com"'),
            createSession: true,
            name: "sam@acme.com",
          }),
        );
      });
      expect(addPasskeyMock.mock.calls[0]?.[0]?.context).toContain(
        '"addressProof":"proof_1"',
      );
    });

    /** @scenario Declining the passkey leaves the password fields where they were */
    it("says nothing and keeps the password fields when the prompt is dismissed", async () => {
      addPasskeyMock.mockResolvedValue({
        error: { code: "ERROR_CEREMONY_ABORTED", status: 400 },
      });
      const { container } = await reachCredentialStep();

      await userEvent.click(screen.getByTestId("passkey-sign-up"));

      await waitFor(() => {
        expect(addPasskeyMock).toHaveBeenCalled();
      });
      // A decision, not a fault. Nothing is reported, nothing navigates, and
      // the other way of finishing is exactly where it was.
      expect(screen.queryByRole("alert")).toBeNull();
      expect(navigateMock).not.toHaveBeenCalled();
      expect(container.querySelector('input[type="password"]')).not.toBeNull();
    });

    /** @scenario A passkey is never registered against an address that already has an account */
    it("returns to log-in when the verified proof has already been claimed", async () => {
      addPasskeyMock.mockResolvedValue({
        error: { code: "EMAIL_ALREADY_REGISTERED", status: 400 },
      });
      await reachCredentialStep();

      await userEvent.click(screen.getByTestId("passkey-sign-up"));

      await waitFor(() => {
        expect(hardRedirectMock).toHaveBeenCalledWith("/auth/signin");
      });
    });

    /**
     * A ceremony started from a sign-up screen is a discoverable-credential
     * request: the browser offers every passkey it holds for this site and
     * picking one signs THAT account in. Somebody mid-sign-up who pressed it
     * landed silently in a different account, having been shown nothing that
     * said so — and it looked like the sign-up had worked.
     *
     */
    /** @scenario The sign-up door never offers to use a passkey that already exists */
    it("never offers an existing passkey, on the address step or after it", async () => {
      routeMock.mockResolvedValue({
        outcome: "method_picker",
        methodSet: [
          { id: "password", kind: "password", connectionId: null },
          { id: "passkey", kind: "passkey", connectionId: null },
        ],
        reasonCode: "no_domain_match",
      } satisfies RoutingDecision);

      renderScreen();
      // The address step, where the instance's other ways in are offered.
      await screen.findByLabelText(/email/i);
      await waitFor(() => expect(routeMock).toHaveBeenCalled());
      expect(screen.queryByTestId("passkey-sign-in")).toBeNull();

      cleanup();
      await reachCredentialStep();

      // And on the credential step the passkey CREATES one for the address
      // being registered, which is the only thing it can honestly do here.
      expect(screen.queryByTestId("passkey-sign-in")).toBeNull();
      expect(screen.getByTestId("passkey-sign-up")).toBeTruthy();
      // Nobody is stranded: the other door is on the card, carrying the
      // address they typed.
      expect(screen.getByTestId("go-to-sign-in")).toBeTruthy();
    });
  });
});
