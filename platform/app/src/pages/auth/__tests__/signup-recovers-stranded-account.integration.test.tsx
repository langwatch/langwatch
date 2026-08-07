/**
 * @vitest-environment jsdom
 *
 * Sign-up never dead-ends someone on their own account.
 *
 * Creating an account is two calls and only the first is durable: one writes
 * the User row and its password, the second exchanges them for a session. A
 * customer reported people hitting an unexplained error on sign-up and, on
 * every retry after it, "User already exists": an account they could not see,
 * sign into, or be found on the members list through, because the failed second
 * leg left them with no session and no organization.
 *
 * Rendered rather than unit-tested against the submit handler: the whole defect
 * was that the screen turned a recoverable state into a wall, so the assertions
 * are about what the screen does next.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sessionRef, publicEnvRef, searchParamsRef, registerRef, signInMock } =
  vi.hoisted(() => ({
    sessionRef: { current: { data: null as unknown } },
    publicEnvRef: {
      current: { NEXTAUTH_PROVIDER: "email" as string | undefined },
    },
    searchParamsRef: { current: new URLSearchParams("") },
    registerRef: {
      current: {
        mutateAsync: vi.fn(() => Promise.resolve({ id: "user_1" })),
        error: null as unknown,
        isLoading: false,
      },
    },
    signInMock: vi.fn(),
  }));

vi.mock("~/utils/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/auth-client")>();
  return {
    ...actual,
    signIn: signInMock,
    useSession: () => sessionRef.current,
  };
});

vi.mock("~/utils/compat/next-navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

vi.mock("~/utils/compat/next-link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../../../utils/api", () => ({
  api: {
    user: { register: { useMutation: () => registerRef.current } },
  },
}));

import SignUp from "../signup";

/**
 * What a tRPC rejection carrying a handled error looks like on the wire: the
 * payload nests under `data.error` and the message IS the code slug (#5984),
 * which is exactly why the screen must read the payload rather than the
 * message.
 */
const alreadyRegistered = () =>
  Object.assign(new Error("email_already_registered"), {
    data: {
      error: {
        code: "email_already_registered",
        meta: {},
        httpStatus: 409,
        fault: "customer",
        reasons: [],
      },
    },
  });

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SignUp />
    </ChakraProvider>,
  );

const fillAndSubmit = (container: HTMLElement) => {
  const set = (name: string, value: string) => {
    const input = container.querySelector<HTMLInputElement>(`[name="${name}"]`);
    if (!input) throw new Error(`no field named ${name}`);
    fireEvent.change(input, { target: { value } });
  };
  set("name", "Returning Colleague");
  set("email", "returning@example.com");
  set("password", "SuperSecret123!");
  set("confirmPassword", "SuperSecret123!");

  const form = container.querySelector("form");
  if (!form) throw new Error("no form");
  fireEvent.submit(form);
};

describe("SignUp when the email already has an account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionRef.current = { data: null };
    publicEnvRef.current = { NEXTAUTH_PROVIDER: "email" };
    searchParamsRef.current = new URLSearchParams("");
    registerRef.current = {
      mutateAsync: vi.fn(() => Promise.resolve({ id: "user_1" })),
      error: null,
      isLoading: false,
    };
  });

  afterEach(() => cleanup());

  describe("when the password is the one on the account", () => {
    /** @scenario "Submitting the same details again signs me in" */
    it("signs them in with the credentials they just typed", async () => {
      const rejection = alreadyRegistered();
      registerRef.current.mutateAsync = vi.fn(() => Promise.reject(rejection));
      registerRef.current.error = rejection;
      signInMock.mockResolvedValue({ ok: true });
      searchParamsRef.current = new URLSearchParams(
        "callbackUrl=%2Finvite%2Faccept%3FinviteCode%3Dabc",
      );

      const { container } = renderPage();
      fillAndSubmit(container);

      await waitFor(() => expect(signInMock).toHaveBeenCalled());
      expect(signInMock).toHaveBeenCalledWith("credentials", {
        email: "returning@example.com",
        password: "SuperSecret123!",
        callbackUrl: "/invite/accept?inviteCode=abc",
      });
    });
  });

  describe("when the password is not the one on the account", () => {
    /** @scenario "An email that belongs to an account I cannot open points at the way in" */
    it("names the account and offers signing in or resetting the password", async () => {
      const rejection = alreadyRegistered();
      registerRef.current.mutateAsync = vi.fn(() => Promise.reject(rejection));
      registerRef.current.error = rejection;
      signInMock.mockResolvedValue({
        ok: false,
        code: "INVALID_EMAIL_OR_PASSWORD",
        error: "Invalid email or password",
        status: 401,
      });

      const { container } = renderPage();
      fillAndSubmit(container);

      await waitFor(() => {
        expect(
          screen.getByText(/that email already has an account/i),
        ).toBeTruthy();
      });
      expect(screen.getByText(/^sign in$/i)).toBeTruthy();
      expect(screen.getByText(/reset your password/i)).toBeTruthy();
      // The code slug is the wire message for a handled error, so putting it on
      // screen is the failure mode this registry exists to prevent.
      expect(screen.queryByText(/email_already_registered/)).toBeNull();
    });
  });

  describe("when recovery fails for a reason of its own", () => {
    /**
     * A rate limit is not "wrong password", and answering it with the
     * already-registered copy would send someone to reset a password that was
     * never the problem.
     */
    /** @scenario "A rate-limited recovery says to wait, not to reset the password" */
    it("says to wait rather than pointing at the password", async () => {
      const rejection = alreadyRegistered();
      registerRef.current.mutateAsync = vi.fn(() => Promise.reject(rejection));
      registerRef.current.error = rejection;
      signInMock.mockResolvedValue({ ok: false, status: 429 });

      const { container } = renderPage();
      fillAndSubmit(container);

      await waitFor(() => {
        expect(screen.getByText(/too many attempts/i)).toBeTruthy();
      });
      expect(screen.queryByText(/reset your password/i)).toBeNull();
    });
  });

  describe("when the account was created but the sign-in leg fails", () => {
    /**
     * The original strand: the durable half succeeded, the session half did
     * not, and on the customer's version the screen answered with a fixed
     * "Failed to sign up" toast. The honest sentence is that the account
     * exists and signing in is the way forward.
     */
    /** @scenario "A sign-up whose second leg fails still says what happened" */
    it("says the account was created rather than that sign-up failed", async () => {
      signInMock.mockResolvedValue({
        ok: false,
        error: "SOME_UNMAPPED_IDENTIFIER",
        status: 400,
      });

      const { container } = renderPage();
      fillAndSubmit(container);

      await waitFor(() => {
        expect(
          screen.getAllByText(/your account was created/i).length,
        ).toBeGreaterThan(0);
      });
      expect(screen.queryByText(/failed to sign up/i)).toBeNull();
      expect(screen.queryByText(/SOME_UNMAPPED_IDENTIFIER/)).toBeNull();
    });
  });

  describe("when the refusal is anything else", () => {
    it("does not attempt a sign-in", async () => {
      const rejection = Object.assign(new Error("validation_error"), {
        data: {
          error: {
            code: "validation_error",
            meta: {},
            httpStatus: 400,
            fault: "customer",
            reasons: [],
          },
        },
      });
      registerRef.current.mutateAsync = vi.fn(() => Promise.reject(rejection));
      registerRef.current.error = rejection;

      const { container } = renderPage();
      fillAndSubmit(container);

      await waitFor(() =>
        expect(registerRef.current.mutateAsync).toHaveBeenCalled(),
      );
      expect(signInMock).not.toHaveBeenCalled();
    });
  });
});
