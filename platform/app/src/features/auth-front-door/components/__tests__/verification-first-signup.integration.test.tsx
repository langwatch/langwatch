/**
 * @vitest-environment jsdom
 *
 * Sign-up, verification first (D13, ADR-117 §6): the address is confirmed
 * before any method is offered, and the method choice is the same picker the
 * sign-in screen renders.
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
  startPasswordSignUpMock,
  routeMock,
  registerMock,
  signInMock,
  searchParamsRef,
} = vi.hoisted(() => ({
  requestVerificationMock: vi.fn(),
  completeVerificationMock: vi.fn(),
  startPasswordSignUpMock: vi.fn(),
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
    return { mutateAsync, isPending, error };
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
        startPasswordSignUp: {
          useMutation: useFakeMutation(startPasswordSignUpMock),
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
    /** @scenario Sign-up verifies the email before any method is chosen */
    it("asks for the address to be confirmed before offering any method", async () => {
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
      expect(screen.queryByTestId("method-picker")).toBeNull();
      expect(container.querySelector('input[type="password"]')).toBeNull();
    });
  });

  describe("when the confirmation link comes back", () => {
    /** @scenario Sign-up verifies the email before any method is chosen */
    it("offers the method choice through the same picker sign-in renders", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({ email: "sam@acme.com" });

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
      completeVerificationMock.mockResolvedValue({ email: "sam@acme.com" });
      registerMock.mockRejectedValue({
        data: {
          error: {
            code: "validation_error",
            httpStatus: 422,
            fault: "customer",
            meta: {
              fieldErrors: {
                password: ["Password must be at least 8 characters"],
              },
            },
          },
        },
      });

      renderScreen();
      await screen.findByTestId("method-picker");

      await userEvent.type(screen.getByLabelText(/^name$/i), "Sam");
      await userEvent.type(screen.getByLabelText(/^password$/i), "shortish");
      await userEvent.type(
        screen.getByLabelText(/confirm password/i),
        "shortish",
      );
      await userEvent.click(
        screen.getByRole("button", { name: /create account/i }),
      );

      expect(
        await screen.findByText(/password must be at least 8 characters/i),
      ).toBeTruthy();
      expect(signInMock).not.toHaveBeenCalled();
    });

    /** @scenario A rejected field says what to fix, next to the field */
    it("says what to fix on blur, before the server is asked at all", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({ email: "sam@acme.com" });

      renderScreen();
      await screen.findByTestId("method-picker");

      await userEvent.type(screen.getByLabelText(/^password$/i), "short");
      await userEvent.tab();

      expect(
        await screen.findByText(/password must be at least 8 characters/i),
      ).toBeTruthy();
      expect(registerMock).not.toHaveBeenCalled();
    });
  });

  describe("when the account creation fields are filled by a password manager", () => {
    /** @scenario The address and password fields cooperate with password managers */
    it("names the address and asks for a new password, both the way a manager expects", async () => {
      searchParamsRef.current = new URLSearchParams("verify=a-token");
      completeVerificationMock.mockResolvedValue({ email: "sam@acme.com" });

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
