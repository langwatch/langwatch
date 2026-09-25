/**
 * @vitest-environment jsdom
 * Sign-up: address, password, account; confirmation enters not gates.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { RoutingDecision } from "@langwatch/identity-contract";
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
    return { mutate, mutateAsync, isPending, error };
  };

  return {
    authApi: {
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

vi.mock("../../elements/router-link.tsx", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import type * as authClientModule from "../../../behavior/auth-client.tsx";
import { VerificationFirstSignUp } from "../verification-first-sign-up.tsx";

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
  });

  afterEach(() => cleanup());

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

  describe("when a confirmation link comes back for an account that exists", () => {
    /** @scenario Sign-up creates the account and confirms the address afterwards */
    it("says the address is confirmed and asks for nothing more", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: true,
        addressProof: null,
      });

      renderScreen();

      // Nothing to choose: sign-up already made the account, and this link is
      // the address catching up with it.
      expect(await screen.findByTestId("account-ready")).toHaveTextContent(/sam@acme\.com/);
      expect(screen.queryByTestId("method-picker")).toBeNull();
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
        expect(addPasskeyMock).toHaveBeenCalledWith(
          expect.objectContaining({
            context: JSON.stringify({ email: "sam@acme.com", addressProof: "proof-1" }),
          }),
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
