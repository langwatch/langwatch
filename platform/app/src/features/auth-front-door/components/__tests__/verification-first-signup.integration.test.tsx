/**
 * @vitest-environment jsdom
 *
 * Sign-up (D13, ADR-117 §6, revised): the address is asked for, a password is
 * chosen, and the account exists. Confirming the address follows the person in
 * rather than gating them, and the address step itself sends nothing.
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
  searchParamsRef,
} = vi.hoisted(() => ({
  requestVerificationMock: vi.fn(),
  completeVerificationMock: vi.fn(),
  sendConfirmationMock: vi.fn(),
  routeMock: vi.fn(),
  registerMock: vi.fn(),
  signInMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams("") },
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
      frontDoor: {
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
  usePublicEnv: () => ({ data: { IS_SAAS: true } }),
}));

vi.mock("~/utils/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/auth-client")>();
  return { ...actual, signIn: signInMock, useSession: () => ({ data: null }) };
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
    requestVerificationMock.mockResolvedValue({ sent: true });
    routeMock.mockResolvedValue(localPicker);
  });

  afterEach(() => cleanup());

  describe("when sign-up starts with a work address", () => {
    /** @scenario Sign-up creates the account and confirms the address afterwards */
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

    /** @scenario Sign-up creates the account and confirms the address afterwards */
    it("registers, signs in, and sends the confirmation after both", async () => {
      registerMock.mockResolvedValue({ id: "user_1" });
      signInMock.mockResolvedValue({});

      const { container } = renderScreen();
      await userEvent.type(
        await screen.findByLabelText(/email/i),
        "sam@acme.com",
      );
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));
      await screen.findByTestId("signup-identifier");

      const passwords = container.querySelectorAll('input[type="password"]');
      await userEvent.type(passwords[0]!, "a-good-password");
      await userEvent.type(passwords[1]!, "a-good-password");
      await userEvent.click(
        screen.getByRole("button", { name: /create|continue|sign up/i }),
      );

      await waitFor(() => {
        expect(registerMock).toHaveBeenCalledWith({
          email: "sam@acme.com",
          password: "a-good-password",
        });
      });
      // No name is asked for: onboarding does that.
      expect(registerMock.mock.calls[0]?.[0]).not.toHaveProperty("name");
      await waitFor(() => expect(sendConfirmationMock).toHaveBeenCalled());
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
      });

      renderScreen();

      // Nothing to choose: sign-up already made the account, and this link is
      // the address catching up with it.
      expect(await screen.findByTestId("account-ready")).toHaveTextContent(
        /sam@acme\.com/,
      );
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

      const passwords = container.querySelectorAll('input[type="password"]');
      await userEvent.type(passwords[0]!, "a-good-password");
      await userEvent.type(passwords[1]!, "a-good-password");
      await userEvent.click(
        screen.getByRole("button", { name: /create|continue|sign up/i }),
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

  describe("when a field the server rejects comes back", () => {
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
        screen.getByRole("button", { name: /create account/i }),
      );

      expect(
        await screen.findByText(/use at least 8 characters/i),
      ).toBeTruthy();
      expect(signInMock).not.toHaveBeenCalled();
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
});
