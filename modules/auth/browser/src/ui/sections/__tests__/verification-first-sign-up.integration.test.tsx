/**
 * @vitest-environment jsdom
 * Sign-up: address, password, account; confirmation enters not gates.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { RoutingDecision } from "@langwatch/identity-contract";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const {
  requestVerificationMock,
  completeVerificationMock,
  enrollmentMock,
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
  completeVerificationMock: vi.fn(),
  enrollmentMock: vi.fn(),
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
vi.mock("../../../behavior/auth-api.ts", async () => {
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
    const reset = useCallback(() => setError(null), []);
    return { mutate, mutateAsync, reset, isPending, error };
  };

  return {
    authApi: {
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

vi.mock("../../../behavior/confirm-sign-up-address.ts", () => ({
  confirmSignUpAddress: completeVerificationMock,
}));

vi.mock("../../../behavior/hard-redirect.ts", () => ({
  hardRedirect: hardRedirectMock,
  isNavigatingAway: () => false,
}));

vi.mock("../../../behavior/use-public-env.ts", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

vi.mock("../../../behavior/auth-client.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof authClientModule>();
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

vi.mock("../../../behavior/use-route.ts", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

import type * as authClientModule from "../../../behavior/auth-client.tsx";
import { signUpHref } from "../../../model/carried-email.ts";
import { _resetTwoStepChallengeForTests } from "../../../model/two-step-challenge.ts";
import { VerificationFirstSignUp } from "../verification-first-sign-up.tsx";

const CEREMONY = z.object({ context: z.string() });

const localPicker: RoutingDecision = {
  outcome: "method_picker",
  methodSet: [{ id: "password", kind: "password", connectionId: null }],
  reasonCode: "no_domain_match",
};

const expiredLink = {
  data: {
    error: {
      code: "identity_verification_expired",
      httpStatus: 410,
      fault: "customer",
    },
  },
};

/** Types password into both fields; confirmation appears after first interaction. */
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
    routeMock.mockResolvedValue(localPicker);
    enrollmentMock.mockResolvedValue({
      outcome: "enroll",
      methodSet: localPicker.methodSet,
      reasonCode: "no_domain_match",
    });
  });

  afterEach(() => {
    cleanup();
    _resetTwoStepChallengeForTests();
  });

  describe("when sign-up starts with a work address", () => {
    /** @scenario Sign-up proves the address before asking for a credential */
    it("sends a confirmation link and shows no credential control yet", async () => {
      const { container } = renderScreen();

      await userEvent.type(await screen.findByLabelText(/email/i), "sam@acme.com");
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      expect(await screen.findByTestId("verification-sent")).toBeTruthy();
      expect(requestVerificationMock).toHaveBeenCalledWith({ email: "sam@acme.com" });
      expect(container.querySelector('input[type="password"]')).toBeNull();
      expect(registerMock).not.toHaveBeenCalled();
    });
  });

  describe("when the opened link returns a proof", () => {
    beforeEach(() => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof-1",
      });
    });

    /** @scenario "Opening the link unlocks credential choice" */
    it("offers a credential for the confirmed address and signs nobody in yet", async () => {
      const { container } = renderScreen();

      expect((await screen.findByTestId("verified-address")).textContent).toContain("sam@acme.com");
      expect(container.querySelector('input[type="password"]')).not.toBeNull();
      expect(registerMock).not.toHaveBeenCalled();
      expect(signInMock).not.toHaveBeenCalled();
    });

    /** @scenario No credential is collected until the confirmation link is opened */
    it("registers with the proof, signs in, and asks for no name", async () => {
      registerMock.mockResolvedValue({ id: "user_1" });
      signInMock.mockResolvedValue({});

      const { container } = renderScreen();
      await screen.findByTestId("signup-identifier");

      await fillPasswordPair(container, "a-good-password");
      await userEvent.click(screen.getByRole("button", { name: /create account/i }));

      await waitFor(() => {
        expect(registerMock).toHaveBeenCalledWith({
          email: "sam@acme.com",
          password: "a-good-password",
          addressProof: "proof-1",
        });
      });
      expect(registerMock.mock.calls[0]?.[0]).not.toHaveProperty("name");
    });

    it("sends no second confirmation link, because the proof already confirmed the address", async () => {
      registerMock.mockResolvedValue({ id: "user_1" });
      signInMock.mockResolvedValue({});

      const { container } = renderScreen();
      await screen.findByTestId("signup-identifier");

      await fillPasswordPair(container, "a-good-password");
      await userEvent.click(screen.getByRole("button", { name: /create account/i }));

      await waitFor(() => {
        expect(signInMock).toHaveBeenCalled();
      });
      expect(sendConfirmationMock).not.toHaveBeenCalled();
    });

    /** @scenario "Mismatched passwords say so" */
    it("says the two passwords differ and creates nothing", async () => {
      renderScreen();
      await screen.findByTestId("signup-identifier");

      await userEvent.type(screen.getByLabelText(/^password$/i), "a-good-password");
      await userEvent.type(screen.getByLabelText(/confirm password/i), "a-different-password");
      await userEvent.click(screen.getByRole("button", { name: /create account/i }));

      expect(await screen.findByText(/the two passwords are not the same/i)).toBeTruthy();
      expect(registerMock).not.toHaveBeenCalled();
    });
  });

  describe("when the installation cannot send email", () => {
    /** @scenario "An installation that cannot send email signs up with a password and leaves the address unconfirmed" */
    it("asks for a password straight away and never says the address is confirmed", async () => {
      requestVerificationMock.mockResolvedValue({ sent: false, addressProof: "unconfirmed_proof" });
      registerMock.mockResolvedValue({ id: "user_1" });
      signInMock.mockResolvedValue({});

      const { container } = renderScreen();
      await userEvent.type(await screen.findByLabelText(/email/i), "sam@acme.com");
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      expect(await screen.findByTestId("unconfirmed-address")).toHaveTextContent(
        "This installation does not send email, so sam@acme.com is not confirmed. Choose a password to finish.",
      );
      expect(enrollmentMock).toHaveBeenCalledWith({
        email: "sam@acme.com",
        addressProof: "unconfirmed_proof",
      });
      expect(screen.queryByTestId("verification-sent")).toBeNull();
      expect(screen.queryByTestId("verified-address")).toBeNull();
      expect(screen.queryByTestId("passkey-sign-up")).toBeNull();

      await fillPasswordPair(container, "a-good-password");
      await userEvent.click(screen.getByRole("button", { name: /create account/i }));

      await waitFor(() => {
        expect(registerMock).toHaveBeenCalledWith({
          email: "sam@acme.com",
          password: "a-good-password",
          addressProof: "unconfirmed_proof",
        });
      });
      await waitFor(() => expect(signInMock).toHaveBeenCalled());
    });

    it("offers no passkey even where the deployment offers passkeys", async () => {
      publicEnvRef.current = { IS_SAAS: true, PASSKEYS_ENABLED: true };
      requestVerificationMock.mockResolvedValue({ sent: false, addressProof: "unconfirmed_proof" });

      const { container } = renderScreen();
      await userEvent.type(await screen.findByLabelText(/email/i), "sam@acme.com");
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      await screen.findByTestId("unconfirmed-address");
      await waitFor(() => {
        expect(container.querySelector('input[type="password"]')).not.toBeNull();
      });
      expect(screen.queryByTestId("passkey-sign-up")).toBeNull();
    });
  });

  describe("when the browser is on a web address the installation is not set up for", () => {
    const invalidOrigin = {
      data: {
        error: {
          code: "auth_invalid_origin",
          httpStatus: 403,
          fault: "customer",
        },
      },
    };

    /** @scenario "A sign-up on a web address the installation is not set up for writes no account" */
    it("says which address to check when creating the account is refused", async () => {
      requestVerificationMock.mockResolvedValue({
        sent: false,
        addressProof: "unconfirmed_proof",
      });
      enrollmentMock.mockResolvedValue({
        outcome: "enroll",
        methodSet: [{ id: "password", kind: "password", connectionId: null }],
        reasonCode: "identifier_unknown",
      });
      registerMock.mockRejectedValue(invalidOrigin);

      const { container } = renderScreen();
      await userEvent.type(await screen.findByLabelText(/email/i), "sam@acme.com");
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));
      await screen.findByTestId("unconfirmed-address");

      await fillPasswordPair(container, "a-good-password");
      await userEvent.click(screen.getByRole("button", { name: "Create account" }));

      expect(
        await screen.findByText(
          /LangWatch is set up for a different web address than the one you are using/,
        ),
      ).toBeTruthy();
      expect(signInMock).not.toHaveBeenCalled();
    });

    /** @scenario "A sign-up started on a web address the installation is not set up for issues nothing" */
    it("says which address to check when starting the sign-up is refused", async () => {
      requestVerificationMock.mockRejectedValue(invalidOrigin);

      renderScreen();
      await userEvent.type(await screen.findByLabelText(/email/i), "sam@acme.com");
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      expect(
        await screen.findByText(
          /LangWatch is set up for a different web address than the one you are using/,
        ),
      ).toBeTruthy();
      expect(screen.queryByTestId("verification-sent")).toBeNull();
      expect(screen.queryByTestId("unconfirmed-address")).toBeNull();
    });
  });

  describe("when the log-in door hands over an unconfirmed proof", () => {
    afterEach(() => {
      window.history.replaceState(null, "", "/");
    });

    /** @scenario An address with no account on an installation that cannot send email goes to the password step */
    it("opens on the password step for the carried address and asks for nothing again", async () => {
      window.history.replaceState(
        null,
        "",
        signUpHref({ email: "sam@acme.com", addressProof: "unconfirmed_proof" }),
      );

      const { container } = renderScreen();

      expect(await screen.findByTestId("unconfirmed-address")).toHaveTextContent(
        "sam@acme.com is not confirmed",
      );
      expect(enrollmentMock).toHaveBeenCalledWith({
        email: "sam@acme.com",
        addressProof: "unconfirmed_proof",
      });
      expect(requestVerificationMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId("verification-sent")).toBeNull();
      await waitFor(() => {
        expect(container.querySelector('input[type="password"]')).not.toBeNull();
      });
      expect(window.location.hash).toBe("");
    });
  });

  describe("when a confirmation link comes back for an account that exists", () => {
    it("goes straight into the app on the session the link opened", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token&callbackUrl=%2Fprojects");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: true,
        addressProof: null,
        signedIn: true,
      });

      renderScreen();

      expect(await screen.findByTestId("signed-in-handoff")).toHaveTextContent(
        "sam@acme.com is confirmed. Taking you to LangWatch.",
      );
      expect(hardRedirectMock).toHaveBeenCalledWith("/projects");
      expect(screen.queryByTestId("method-picker")).toBeNull();
      expect(routeMock).not.toHaveBeenCalled();
    });

    /** @scenario Sign-up creates the account and confirms the address afterwards */
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

      // One link is one way in: the routed picker, since the account may hold a passkey.
      expect(await screen.findByTestId("account-ready")).toHaveTextContent(/sam@acme\.com/);
      expect(await screen.findByTestId("method-picker")).toBeTruthy();
      expect(screen.queryByTestId("passkey-sign-up")).toBeNull();
      expect(hardRedirectMock).not.toHaveBeenCalled();
    });
  });

  describe("when a reopened link returns no usable proof", () => {
    it("offers a fresh link and confirms nothing", async () => {
      searchParamsRef.current = new URLSearchParams("verify=spent-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: null,
        signedIn: false,
      });

      const { container } = renderScreen();

      expect(await screen.findByText("That confirmation link no longer works")).toBeTruthy();
      expect(screen.getByRole("button", { name: /send a new link/i })).toBeTruthy();
      expect(screen.queryByTestId("verified-address")).toBeNull();
      expect(container.querySelector('input[type="password"]')).toBeNull();
      expect(enrollmentMock).not.toHaveBeenCalled();

      await userEvent.type(screen.getByLabelText(/email/i), "sam@acme.com");
      await userEvent.click(screen.getByRole("button", { name: /send a new link/i }));

      expect(await screen.findByTestId("verification-sent")).toBeTruthy();
      expect(requestVerificationMock).toHaveBeenCalledWith({ email: "sam@acme.com" });
    });
  });

  describe("when a confirmation link comes back with no account behind it", () => {
    /** @scenario Signing in without an account creates it through verification */
    it("offers the method choice through the same picker sign-in renders", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof-1",
      });

      const { container } = renderScreen();

      expect(await screen.findByTestId("verified-address")).toHaveTextContent(/sam@acme\.com/);
      expect(await screen.findByTestId("method-picker")).toBeTruthy();
      await waitFor(() => {
        expect(container.querySelector('input[type="password"]')).not.toBeNull();
      });
      expect(enrollmentMock).toHaveBeenCalledWith({
        email: "sam@acme.com",
        addressProof: "proof-1",
      });
    });
  });

  describe("when deciding where a proven address goes fails", () => {
    beforeEach(() => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof-1",
      });
    });

    /** @scenario Post-link routing still governs credential enrollment */
    it("offers no credential and retries the same proof", async () => {
      enrollmentMock.mockRejectedValueOnce(new Error("router down"));
      const { container } = renderScreen();

      expect(await screen.findByTestId("post-link-routing-failure")).toBeTruthy();
      expect(container.querySelector('input[type="password"]')).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(await screen.findByTestId("method-picker")).toBeTruthy();
      expect(enrollmentMock).toHaveBeenLastCalledWith({
        email: "sam@acme.com",
        addressProof: "proof-1",
      });
    });

    /** @scenario Post-link routing still governs credential enrollment */
    it("hands a domain now routed to a provider to it, offering no local credential", async () => {
      const okta = { id: "okta", kind: "federated" as const, connectionId: "conn_acme" };
      enrollmentMock.mockResolvedValueOnce({
        outcome: "redirect",
        methodSet: [okta],
        reasonCode: "domain_routed",
      });
      routeMock.mockResolvedValue({
        outcome: "redirect_to_connection",
        connectionId: "conn_acme",
        methodSet: [okta],
        reasonCode: "domain_routed",
      });
      const { container } = renderScreen();

      expect(await screen.findByTestId("routed-to-connection")).toBeTruthy();
      expect(screen.queryByTestId("welcome-back")).toBeNull();
      expect(container.querySelector('input[type="password"]')).toBeNull();
      expect(screen.queryByTestId("verified-address")).toBeNull();
      await waitFor(() => {
        expect(signInMock).toHaveBeenCalledWith(
          "okta",
          expect.objectContaining({ loginHint: "sam@acme.com" }),
        );
      });
    });
  });

  describe("when the confirmation link has expired", () => {
    /** @scenario An expired verification link offers a resend, nothing else */
    it("says the link expired, offers a fresh one, and confirms nothing", async () => {
      searchParamsRef.current = new URLSearchParams("verify=stale-token");
      completeVerificationMock.mockRejectedValue(expiredLink);

      const { container } = renderScreen();

      expect(await screen.findByText(/that verification link has expired/i)).toBeTruthy();
      expect(screen.getByRole("button", { name: /send a new link/i })).toBeTruthy();

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

      await userEvent.type(await screen.findByLabelText(/email/i), "sam@acme.com");
      await userEvent.click(screen.getByRole("button", { name: /^continue$/i }));

      // The page quietly becomes the log-in step: same address, same methods,
      // and the door back into a half-created account beside it.
      expect(await screen.findByTestId("method-picker")).toBeTruthy();
      expect(screen.getByTestId("routed-identifier")).toHaveTextContent("sam@acme.com");
      expect(screen.getByRole("button", { name: /^log in$/i })).toBeTruthy();
      expect(screen.getByRole("link", { name: /forgot password/i })).toBeTruthy();
      expect(container.querySelector('input[type="email"]')).toBeNull();
      expect(screen.queryByTestId("verification-sent")).toBeNull();

      // Nothing anywhere says an account exists, and nothing reads as a
      // refusal: no alert, no notice, no wording about the address.
      expect(container.textContent).not.toMatch(/already (have|has)/i);
      expect(container.textContent).not.toMatch(/registered|exists/i);
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    /** @scenario Returning to the address step clears the refusal that sent me to log-in */
    it("returns to the address step with no trace of the refusal", async () => {
      requestVerificationMock.mockRejectedValueOnce({
        data: { error: { code: "email_already_registered", httpStatus: 409, fault: "customer" } },
      });

      const { container } = renderScreen();
      await userEvent.type(await screen.findByLabelText(/email/i), "sam@acme.com");
      await userEvent.click(screen.getByRole("button", { name: /^continue$/i }));
      await screen.findByTestId("method-picker");

      await userEvent.click(screen.getByRole("button", { name: /use a different email/i }));

      expect(await screen.findByLabelText(/email/i)).toBeTruthy();
      expect(screen.queryByTestId("method-picker")).toBeNull();
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.textContent).not.toMatch(/already|registered|exists/i);
    });

    /** @scenario A correct password with a second factor asks for the code on the same card */
    it("asks for the second factor on the same card when the password was right", async () => {
      requestVerificationMock.mockRejectedValue({
        data: { error: { code: "email_already_registered", httpStatus: 409, fault: "customer" } },
      });
      signInMock.mockResolvedValue({ ok: false, twoStepRequired: true });

      const { container } = renderScreen();
      await userEvent.type(await screen.findByLabelText(/email/i), "sam@acme.com");
      await userEvent.click(screen.getByRole("button", { name: /^continue$/i }));
      await screen.findByTestId("method-picker");

      await userEvent.type(
        container.querySelector('input[type="password"]') as HTMLInputElement,
        "the-right-password",
      );
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));

      expect(await screen.findByText("Enter your verification code")).toBeTruthy();
      expect(screen.getByTestId("two-step-code")).toBeTruthy();
      expect(container.querySelector('input[type="password"]')).toBeNull();
    });
  });

  describe("when the address's domain routes through an identity provider", () => {
    /** @scenario Sign-up hands a single-sign-on domain to its provider */
    it("hands it to the provider instead of sending a link or asking for a credential", async () => {
      const okta = { id: "okta", kind: "federated" as const, connectionId: "conn_acme" };
      routeMock.mockResolvedValue({
        outcome: "redirect_to_connection",
        connectionId: "conn_acme",
        methodSet: [okta],
        reasonCode: "domain_routed",
      });

      const { container } = renderScreen();
      await userEvent.type(await screen.findByLabelText(/email/i), "sam@acme.com");
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      await screen.findByTestId("routed-to-connection");
      expect(screen.queryByTestId("signup-identifier")).toBeNull();
      expect(container.querySelector('input[type="password"]')).toBeNull();
      expect(requestVerificationMock).not.toHaveBeenCalled();
      expect(registerMock).not.toHaveBeenCalled();
    });
  });

  describe("when somebody meant to log in instead", () => {
    it("offers the log-in door under the address step, carrying the callback", async () => {
      searchParamsRef.current = new URLSearchParams("callbackUrl=/settings");
      renderScreen();

      const link = await screen.findByTestId("go-to-sign-in");
      expect(link).toHaveTextContent("Or log in instead");
      expect(link.getAttribute("href")).toBe("/auth/signin?callbackUrl=%2Fsettings");
    });
  });

  describe("when a field the server rejects comes back", () => {
    /** @scenario A rejected field says what to fix, next to the field */
    it("puts the complaint on the field that caused it", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof-1",
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
      await userEvent.type(screen.getByLabelText(/confirm password/i), "shortish");
      await userEvent.click(screen.getByRole("button", { name: /create account/i }));

      expect(await screen.findByText(/use at least 8 characters/i)).toBeTruthy();
      expect(signInMock).not.toHaveBeenCalled();
    });

    /** @scenario A rejected field says what to fix, next to the field */
    it("says what to fix on blur, before the server is asked at all", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof-1",
      });

      renderScreen();
      await screen.findByTestId("method-picker");

      await userEvent.type(screen.getByLabelText(/^password$/i), "short");
      await userEvent.tab();

      expect(await screen.findByText(/use at least 8 characters/i)).toBeTruthy();
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
        addressProof: "proof-1",
      });

      const { container } = renderScreen();
      await screen.findByTestId("method-picker");

      const carriedEmail = container.querySelector('input[name="email"]');
      expect(carriedEmail?.getAttribute("value")).toBe("sam@acme.com");
      expect(carriedEmail?.getAttribute("autocomplete")).toBe("username");

      for (const field of container.querySelectorAll('input[type="password"]')) {
        expect(field.getAttribute("autocomplete")).toBe("new-password");
      }
    });
  });

  describe("when the deployment offers passkeys", () => {
    /** Reaches the credential step the way every sign-up does: through an opened link. */
    const reachCredentialStep = async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof-1",
      });
      const rendered = renderScreen();
      await screen.findByTestId("signup-identifier");
      return rendered;
    };

    beforeEach(() => {
      publicEnvRef.current = { IS_SAAS: true, PASSKEYS_ENABLED: true };
    });

    it("offers a passkey as well as a password, not instead of one", async () => {
      const { container } = await reachCredentialStep();

      expect(await screen.findByTestId("passkey-sign-up")).toBeTruthy();
      await waitFor(() => {
        expect(container.querySelector('input[type="password"]')).not.toBeNull();
      });
    });

    /** @scenario Signing up with a passkey consumes the verified address proof */
    it("carries the typed address and its proof into the ceremony", async () => {
      addPasskeyMock.mockResolvedValue({ data: { id: "passkey_1" } });
      await reachCredentialStep();

      await userEvent.click(screen.getByTestId("passkey-sign-up"));

      await waitFor(() => {
        expect(addPasskeyMock).toHaveBeenCalled();
      });
      const [ceremony] = addPasskeyMock.mock.calls[0] ?? [];
      expect(JSON.parse(CEREMONY.parse(ceremony).context)).toEqual({
        email: "sam@acme.com",
        addressProof: "proof-1",
        claim: expect.any(String),
      });
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
  });

  describe("when this deployment never mounted passkeys", () => {
    it("offers no passkey, because there is no endpoint behind one", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof-1",
      });
      renderScreen();

      await screen.findByTestId("signup-identifier");
      expect(screen.queryByTestId("passkey-sign-up")).toBeNull();
    });
  });
});
