/**
 * @vitest-environment jsdom
 *
 * Sign-up (D13, ADR-117 §6): the address is asked for, a password or passkey
 * is chosen, and the account exists — but no session does. The address is
 * confirmed BEFORE anybody gets in, so the screen becomes "check your email"
 * and the emailed link opens the first session. The address step itself sends
 * nothing.
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
  completeVerificationMock,
  sendConfirmationMock,
  routeMock,
  registerMock,
  signInMock,
  addPasskeyMock,
  navigateMock,
  searchParamsRef,
  publicEnvRef,
} = vi.hoisted(() => ({
  requestVerificationMock: vi.fn(),
  completeVerificationMock: vi.fn(),
  sendConfirmationMock: vi.fn(),
  routeMock: vi.fn(),
  registerMock: vi.fn(),
  signInMock: vi.fn(),
  addPasskeyMock: vi.fn(),
  navigateMock: vi.fn(),
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
        completeSignUpVerification: {
          useMutation: useFakeMutation(completeVerificationMock),
        },
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

const expiredLink = {
  data: {
    error: {
      code: "identity_verification_expired",
      httpStatus: 410,
      fault: "customer",
    },
  },
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
    routeMock.mockResolvedValue(localPicker);
  });

  afterEach(() => cleanup());

  describe("when sign-up starts with a work address", () => {
    /** @scenario Sign-up creates the account but does not let me in until I confirm */
    it("asks for a password next, and sends nothing on the way", async () => {
      const { container } = renderScreen();

      await userEvent.type(
        await screen.findByLabelText(/email/i),
        "sam@acme.com",
      );
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      // The password step, with the address named on it and a way back.
      expect(await screen.findByTestId("signup-identifier")).toHaveTextContent(
        /sam@acme\.com/,
      );
      await waitFor(() => {
        expect(
          container.querySelector('input[type="password"]'),
        ).not.toBeNull();
      });
      // Nothing has been created and nothing sent: an address typed here
      // costs nobody an email until they finish.
      expect(requestVerificationMock).not.toHaveBeenCalled();
      expect(registerMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId("verification-sent")).toBeNull();
    });

    /** @scenario Sign-up creates the account but does not let me in until I confirm */
    it("registers, and stops at the confirmation instead of signing in", async () => {
      registerMock.mockResolvedValue({ id: "user_1" });

      const { container } = renderScreen();
      await userEvent.type(
        await screen.findByLabelText(/email/i),
        "sam@acme.com",
      );
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));
      await screen.findByTestId("signup-identifier");

      await fillPasswordPair(container, "a-good-password");
      await userEvent.click(
        screen.getByRole("button", { name: "Create account" }),
      );

      await waitFor(() => {
        expect(registerMock).toHaveBeenCalledWith(
          expect.objectContaining({
            email: "sam@acme.com",
            password: "a-good-password",
          }),
        );
      });
      // No name is asked for: onboarding does that.
      expect(registerMock.mock.calls[0]?.[0]).not.toHaveProperty("name");

      // THE point of the order. The account exists, and the person does not
      // get in on it until the address is proved.
      expect(await screen.findByTestId("verification-sent")).toHaveTextContent(
        /sam@acme\.com/,
      );
      expect(signInMock).not.toHaveBeenCalled();
      // Nor does the screen send the link: the server sends it from the same
      // call that created the account, because there is no session to send
      // from here.
      expect(sendConfirmationMock).not.toHaveBeenCalled();
    });
  });

  describe("when a confirmation link comes back for an account that exists", () => {
    /** @scenario Opening the link is what signs me in for the first time */
    it("says the address is confirmed and offers the way in", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: true,
        addressProof: null,
      });

      renderScreen();

      expect(await screen.findByTestId("account-ready")).toHaveTextContent(
        /sam@acme\.com/,
      );
      // The link is the LAST step of sign-up, not a receipt for it: no
      // session exists yet, so the way in has to be on this card. The routed
      // picker rather than a password box, because the credential this
      // account holds may be a passkey — offering a password to somebody who
      // never set one is the dead end this replaced.
      expect(await screen.findByTestId("method-picker")).toBeTruthy();
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
      expect(routeMock).toHaveBeenCalledWith({
        identifier: "sam@acme.com",
        breakGlass: false,
      });
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
      // The refusal now comes from registering, not from asking for a link:
      // the address step sends nothing, so the address is only tested against
      // the directory when the account is actually being made.
      registerMock.mockRejectedValue({
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
      await screen.findByTestId("signup-identifier");

      await fillPasswordPair(container, "a-good-password");
      await userEvent.click(
        screen.getByRole("button", { name: "Create account" }),
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
    /** Reaches the credential step with an address typed on the one before. */
    const reachCredentialStep = async () => {
      const rendered = renderScreen();
      await userEvent.type(
        await screen.findByLabelText(/email/i),
        "sam@acme.com",
      );
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));
      await screen.findByTestId("signup-identifier");
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
          expect.objectContaining({ context: "sam@acme.com" }),
        );
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

    /** @scenario Sign-up with an address that already has an account becomes a log-in */
    it("turns into the log-in screen when the address already has an account", async () => {
      addPasskeyMock.mockResolvedValue({
        error: { code: "EMAIL_ALREADY_REGISTERED", status: 400 },
      });
      await reachCredentialStep();

      await userEvent.click(screen.getByTestId("passkey-sign-up"));

      // Not a failed ceremony — the wrong door, answered by the right one with
      // the address already in it.
      expect(await screen.findByTestId("method-picker")).toBeTruthy();
      expect(screen.queryByTestId("passkey-sign-up")).toBeNull();
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

      await userEvent.type(screen.getByLabelText(/email/i), "sam@acme.com");
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));
      await screen.findByTestId("signup-identifier");

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
