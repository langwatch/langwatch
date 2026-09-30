/**
 * @vitest-environment jsdom
 * Identifier-first sign-in renders routing decisions; holds no routing logic.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { RoutingDecision, SignInMethod } from "@langwatch/identity-contract";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  routeMock,
  routeErrorRef,
  requestSignUpVerificationMock,
  registerMock,
  signInMock,
  replaceMock,
  sessionRef,
  searchParamsRef,
  publicEnvRef,
  priorSessionRef,
} = vi.hoisted(() => ({
  routeMock: vi.fn(),
  routeErrorRef: { current: null as unknown },
  requestSignUpVerificationMock: vi.fn(),
  registerMock: vi.fn(),
  signInMock: vi.fn(),
  replaceMock: vi.fn(),
  sessionRef: { current: { data: null as unknown } },
  searchParamsRef: { current: new URLSearchParams("") },
  publicEnvRef: { current: { IS_SAAS: true } as Record<string, unknown> },
  priorSessionRef: ((): { current: unknown } => ({ current: undefined }))(),
}));

vi.mock("../../../behavior/auth-api.ts", () => ({
  authApi: {
    auth: {
      route: {
        useMutation: () => ({
          mutateAsync: routeMock,
          isPending: false,
          error: routeErrorRef.current,
        }),
      },
      requestSignUpVerification: {
        useMutation: () => ({
          mutateAsync: requestSignUpVerificationMock,
          isPending: false,
          error: null,
        }),
      },
      priorSession: {
        useQuery: () => ({ data: priorSessionRef.current }),
      },
    },
    user: {
      register: {
        useMutation: () => ({ mutateAsync: registerMock, isPending: false, error: null }),
      },
    },
  },
}));

vi.mock("../../../behavior/use-public-env.ts", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

vi.mock("../../../behavior/auth-client.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof authClientModule>();
  return {
    ...actual,
    signIn: signInMock,
    useSession: () => sessionRef.current,
  };
});

vi.mock("../../../behavior/browser-navigation.ts", () => ({
  replaceLocation: replaceMock,
  hardNavigate: vi.fn(),
  reloadPage: vi.fn(),
}));

vi.mock("../../../behavior/use-route.ts", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

import type * as authClientModule from "../../../behavior/auth-client.tsx";
import {
  LAST_USED_METHOD_STORAGE_KEY,
  promotePendingMethod,
} from "../../../model/last-used-method.ts";
import { _resetTwoStepChallengeForTests } from "../../../model/two-step-challenge.ts";
import { IdentifierFirstSignIn } from "../identifier-first-sign-in.tsx";

const passwordMethod: SignInMethod = {
  id: "password",
  kind: "password",
  connectionId: null,
};

const oktaMethod: SignInMethod = {
  id: "okta",
  kind: "federated",
  connectionId: "org:acme",
};

const localPicker: RoutingDecision = {
  outcome: "method_picker",
  methodSet: [passwordMethod],
  reasonCode: "no_domain_match",
};

/** Nobody holds the address: the router's answer, asked by the address step
 *  or by the password form. */
const unknownIdentifier: RoutingDecision = {
  outcome: "route_to_signup",
  methodSet: [],
  reasonCode: "identifier_unknown",
};

const renderScreen = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <IdentifierFirstSignIn />
    </ChakraProvider>,
  );

/**
 * The rendered picker, with the two things that legitimately differ between
 * two renders taken out: the address that was typed, and React's per-render
 * field ids. What is left is the screen itself, which must be identical.
 */
const pickerMarkup = (container: HTMLElement, email: string): string => {
  const picker = container.querySelector('[data-testid="method-picker"]');
  if (!picker) throw new Error("no method picker rendered");
  // The address also rides, encoded, in the forgot-password link.
  return picker.innerHTML
    .replaceAll(email, "")
    .replaceAll(encodeURIComponent(email), "")
    .replace(/_r_[0-9a-z]+_/g, "_field_");
};

const enterEmail = async (email: string) => {
  const field = await screen.findByLabelText(/email/i);
  await userEvent.type(field, email);
  await userEvent.click(screen.getByRole("button", { name: /^continue$/i }));
};

describe("given the identifier-first sign-in screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The address has an account unless a test says otherwise, which is what
    // makes a rejected password a WRONG password by default. The router is
    // what answers that now: a picker means somebody holds the address, and
    // only `route_to_signup` says nobody does.
    requestSignUpVerificationMock.mockRejectedValue(new Error("email_already_registered"));
    registerMock.mockResolvedValue({ ok: true });
    routeErrorRef.current = null;
    sessionRef.current = { data: null };
    searchParamsRef.current = new URLSearchParams("");
    publicEnvRef.current = { IS_SAAS: true };
    priorSessionRef.current = undefined;
    window.localStorage.clear();
    _resetTwoStepChallengeForTests();
  });

  afterEach(() => cleanup());

  describe("when an expired session of this browser's explains the arrival", () => {
    /** @scenario "An expired session is recognised and the address carried forward" */
    it("carries the address to the method step without anybody typing it", async () => {
      priorSessionRef.current = { kind: "expired", email: "sam@acme.com" };
      // Two answers: the instance question the screen always asks on mount,
      // then the one the recovered address asks.
      routeMock.mockResolvedValueOnce(localPicker).mockResolvedValueOnce(localPicker);

      renderScreen();

      // The address step is skipped entirely — the person lands where they
      // would have landed had they typed what we already knew.
      await waitFor(() => {
        expect(routeMock).toHaveBeenCalledWith(
          expect.objectContaining({ identifier: "sam@acme.com" }),
        );
      });
      expect(await screen.findByText(/welcome back/i)).toBeInTheDocument();
    });

    /** @scenario "The expired notice replaces the greeting, not the error copy" */
    it("says the session ran out, and does not greet a stranger or report a fault", async () => {
      priorSessionRef.current = { kind: "expired", email: "sam@acme.com" };
      routeMock.mockResolvedValueOnce(localPicker).mockResolvedValueOnce(localPicker);

      renderScreen();

      expect(await screen.findByText(/welcome back/i)).toBeInTheDocument();
      expect(screen.getByText(/session expired/i)).toBeInTheDocument();
      // Not the first-time greeting, and not an error: nothing went wrong, and
      // an error tone sends somebody looking for a fault that does not exist.
      expect(screen.queryByText(/log in to langwatch/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/went wrong/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    /** @scenario "Recognition is not authentication" */
    it("still demands a credential, and signs nobody in on its own", async () => {
      priorSessionRef.current = { kind: "expired", email: "sam@acme.com" };
      routeMock.mockResolvedValueOnce(localPicker).mockResolvedValueOnce(localPicker);

      renderScreen();
      await screen.findByText(/welcome back/i);

      // Knowing who somebody is is not proof that they are. The password form
      // the picker renders is the proof, and nothing has been signed in.
      // Exact label: /password/i also catches the "Forgot password?" link.
      expect(await screen.findByLabelText("Password")).toBeInTheDocument();
      expect(signInMock).not.toHaveBeenCalled();
      expect(replaceMock).not.toHaveBeenCalled();
    });

    /**
     * THE SECURITY ONE. A revoked session answers `unknown`, like a forgery,
     * so the screen must look exactly like the cold one: naming the account
     * after somebody ended every session would undo that.
     */
    /** @scenario "A revoked session is given the cold screen and no address" */
    it("gives a revoked session the cold screen, naming nobody", async () => {
      priorSessionRef.current = { kind: "unknown" };
      routeMock.mockResolvedValue(localPicker);

      renderScreen();

      expect(await screen.findByText(/log in to langwatch/i)).toBeInTheDocument();
      expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/session expired/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/acme\.com/i)).not.toBeInTheDocument();
      // And no address was handed to the router on anybody's behalf.
      expect(routeMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ identifier: expect.stringContaining("@") }),
      );
    });
  });

  /** @scenario "A sole SSO provider waits for a sign-in gesture" */
  it("waits for an explicit click before using the sole provider", async () => {
    routeMock.mockResolvedValue({
      outcome: "redirect_to_connection",
      connectionId: "org:acme",
      methodSet: [oktaMethod],
      reasonCode: "sole_connection",
    });
    renderScreen();
    const continueButton = await screen.findByRole("button", {
      name: /continue with okta/i,
    });
    expect(signInMock).not.toHaveBeenCalled();
    await userEvent.click(continueButton);
    expect(signInMock).toHaveBeenCalledTimes(1);
    expect(signInMock).toHaveBeenCalledWith(
      "okta",
      expect.objectContaining({ callbackUrl: undefined }),
    );
  });

  describe("when an address routes to an identity provider", () => {
    /** @scenario The email step renders the routed outcome */
    /** @scenario "The address typed on our screen rides along to the identity provider" */
    it("sends the person to the provider the decision named, address in hand", async () => {
      routeMock.mockResolvedValueOnce(localPicker).mockResolvedValueOnce({
        outcome: "redirect_to_connection",
        connectionId: "org:acme",
        methodSet: [oktaMethod],
        reasonCode: "domain_routed",
      } satisfies RoutingDecision);

      renderScreen();
      await enterEmail("sam@acme.com");

      await waitFor(() => {
        // The typed address rides along as the OIDC login hint, so the
        // provider's screen arrives prefilled with it.
        expect(signInMock).toHaveBeenCalledWith("okta", {
          callbackUrl: undefined,
          loginHint: "sam@acme.com",
        });
      });
      expect(await screen.findByTestId("routed-to-connection")).toHaveTextContent(/okta/i);
    });

    /** @scenario "A provider my address was routed to is badged once it lets me in" */
    it("parks the provider it dials, so the landing can badge it", async () => {
      routeMock.mockResolvedValueOnce(localPicker).mockResolvedValueOnce({
        outcome: "redirect_to_connection",
        connectionId: "org:acme",
        methodSet: [oktaMethod],
        reasonCode: "domain_routed",
      } satisfies RoutingDecision);

      renderScreen();
      await enterEmail("sam@acme.com");
      await waitFor(() => expect(signInMock).toHaveBeenCalled());

      // Nothing is badged by the dial itself: the provider may still refuse.
      expect(window.localStorage.getItem(LAST_USED_METHOD_STORAGE_KEY)).toBeNull();
      // The landing is what promotes it, exactly as the session fetch does.
      promotePendingMethod();
      expect(window.localStorage.getItem(LAST_USED_METHOD_STORAGE_KEY)).toBe(oktaMethod.id);
    });

    /** @scenario Wrong-method guidance points at the method my account holds */
    it("names the organization's method and offers no password form", async () => {
      routeMock.mockResolvedValueOnce(localPicker).mockResolvedValueOnce({
        outcome: "redirect_to_connection",
        connectionId: "org:acme",
        methodSet: [oktaMethod],
        reasonCode: "domain_routed",
      } satisfies RoutingDecision);

      const { container } = renderScreen();
      await enterEmail("sam@acme.com");

      expect(await screen.findByRole("button", { name: /continue with okta/i })).toBeTruthy();
      expect(container.querySelector('input[type="password"]')).toBeNull();
    });
  });

  describe("when nothing routes the address", () => {
    /** @scenario The email step renders the routed outcome */
    it("shows the method picker the decision named", async () => {
      routeMock.mockResolvedValue(localPicker);

      const { container } = renderScreen();
      await enterEmail("sam@example.com");

      expect(await screen.findByTestId("method-picker")).toBeTruthy();
      await waitFor(() => {
        expect(container.querySelector('input[type="password"]')).not.toBeNull();
      });
      expect(signInMock).not.toHaveBeenCalled();
    });
  });

  describe("when the router itself cannot be reached", () => {
    it("says so and leaves the address field there to try again", async () => {
      routeMock.mockRejectedValue(new Error("router unreachable"));
      routeErrorRef.current = new Error("router unreachable");

      renderScreen();
      await enterEmail("sam@example.com");

      expect(await screen.findByText(/could not start log-in/i)).toBeTruthy();
      // The retry IS the field. An alert that replaces it leaves somebody
      // holding an apology with nothing to act on.
      expect(await screen.findByLabelText(/email/i)).toBeTruthy();
      expect(screen.getByRole("button", { name: /^continue$/i })).toBeTruthy();
    });

    it("offers the address form rather than a picker built from a failed decision", async () => {
      // The hook keeps the last decision on purpose, so a screen that only
      // checked for one would answer a failed attempt with the methods from
      // the attempt before it.
      routeMock.mockResolvedValue(localPicker);
      routeErrorRef.current = new Error("router unreachable");

      renderScreen();
      await enterEmail("sam@example.com");

      expect(screen.queryByTestId("method-picker")).toBeNull();
      expect(await screen.findByLabelText(/email/i)).toBeTruthy();
    });
  });

  describe("when two visitors receive the same routed decision", () => {
    it("renders the same picker, from the same one request, for both", async () => {
      routeMock.mockResolvedValue(localPicker);

      const registered = renderScreen();
      await enterEmail("registered@example.com");
      await screen.findByTestId("method-picker");
      const registeredRequests = routeMock.mock.calls.length;
      const registeredMarkup = pickerMarkup(registered.container, "registered@example.com");
      cleanup();

      routeMock.mockClear();
      const unknown = renderScreen();
      await enterEmail("nobody@example.com");
      await screen.findByTestId("method-picker");

      expect(routeMock.mock.calls.length).toBe(registeredRequests);
      expect(pickerMarkup(unknown.container, "nobody@example.com")).toBe(registeredMarkup);
    });

    it("never says whether an account exists", async () => {
      routeMock.mockResolvedValue(localPicker);

      const { container } = renderScreen();
      await enterEmail("nobody@example.com");
      await screen.findByTestId("method-picker");

      expect(container.textContent).not.toMatch(/no account|not registered/i);
      expect(container.textContent).not.toMatch(/already (have|has) an account/i);
    });
  });

  describe("when the decision refuses with a reason code", () => {
    /** @scenario A deny decision explains itself in words from the registry */
    it("shows the registered copy and never the code", async () => {
      routeMock.mockResolvedValueOnce(localPicker).mockResolvedValueOnce({
        outcome: "method_picker",
        methodSet: [passwordMethod],
        reasonCode: "connection_suspended",
      } satisfies RoutingDecision);

      const { container } = renderScreen();
      await enterEmail("sam@acme.com");

      expect(
        await screen.findByText(/single sign-on is paused for your organization/i),
      ).toBeTruthy();
      expect(container.textContent).not.toContain("connection_suspended");
      expect(container.textContent).not.toMatch(/error|unknown/i);
    });
  });

  describe("when the password typed into the picker is wrong", () => {
    /** @scenario A wrong password says the password is wrong */
    it("says so next to the form, without an internal code", async () => {
      routeMock.mockResolvedValue(localPicker);
      signInMock.mockResolvedValue({
        error: "INVALID_EMAIL_OR_PASSWORD",
        code: "INVALID_EMAIL_OR_PASSWORD",
        status: 401,
      });

      const { container } = renderScreen();
      await enterEmail("sam@example.com");
      await screen.findByTestId("method-picker");

      await userEvent.type(container.querySelector('input[type="password"]')!, "wrong-password");
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));

      expect(await screen.findByText(/invalid email or password/i)).toBeTruthy();
      expect(container.textContent).not.toContain("INVALID_EMAIL_OR_PASSWORD");
    });
  });

  describe("when the address typed in has no account at all", () => {
    /**
     * The router is asked three times: on mount, for the typed address, and
     * by the password form to tell a wrong password from a sign-up. Only the
     * last says nobody holds the address.
     */
    const refusedForAnUnheldAddress = () => {
      routeMock
        .mockResolvedValueOnce(localPicker)
        .mockResolvedValueOnce(localPicker)
        .mockResolvedValue(unknownIdentifier);
      signInMock.mockResolvedValue({
        error: "INVALID_EMAIL_OR_PASSWORD",
        code: "INVALID_EMAIL_OR_PASSWORD",
        status: 401,
      });
    };

    /** @scenario A password typed at the log-in door never becomes an account's password */
    it("asks for verification and never banks the password that was typed", async () => {
      refusedForAnUnheldAddress();

      const { container } = renderScreen();
      await enterEmail("nobody@example.com");
      await screen.findByTestId("method-picker");

      await userEvent.type(container.querySelector('input[type="password"]')!, "a-new-password");
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));

      expect(await screen.findByTestId("unknown-identifier")).toHaveTextContent(
        "nobody@example.com",
      );
      expect(container.querySelector('input[type="password"]')).toBeNull();
      expect(screen.getByRole("button", { name: /send confirmation link/i })).toBeTruthy();
      // No refusal is shown on the way: nothing dead-ends here.
      expect(container.textContent).not.toMatch(/invalid email or password/i);
    });

    /** @scenario Converting at the log-in door still asks for the password properly */
    it("sends verification before asking for a new password", async () => {
      refusedForAnUnheldAddress();

      const { container } = renderScreen();
      await enterEmail("nobody@example.com");
      await screen.findByTestId("method-picker");
      await userEvent.type(
        container.querySelector('input[type="password"]')!,
        "typed-at-the-log-in-door",
      );
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));
      await screen.findByTestId("unknown-identifier");

      await userEvent.click(screen.getByRole("button", { name: /send confirmation link/i }));
      expect(requestSignUpVerificationMock).toHaveBeenCalledWith({
        email: "nobody@example.com",
      });
      expect(registerMock).not.toHaveBeenCalled();
    });

    /** @scenario No credential is collected until the confirmation link is opened */
    it("creates no account while the confirmation is being sent", async () => {
      refusedForAnUnheldAddress();

      const { container } = renderScreen();
      await enterEmail("nobody@example.com");
      await screen.findByTestId("method-picker");
      await userEvent.type(container.querySelector('input[type="password"]')!, "a-new-password");
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));
      await screen.findByTestId("unknown-identifier");

      await userEvent.click(screen.getByRole("button", { name: /send confirmation link/i }));
      expect(requestSignUpVerificationMock).toHaveBeenCalled();
      expect(registerMock).not.toHaveBeenCalled();
    });

    /** @scenario Going back from a sent link returns to the address step */
    it("goes back to the address step when the address was wrong", async () => {
      refusedForAnUnheldAddress();

      const { container } = renderScreen();
      await enterEmail("typo@example.com");
      await screen.findByTestId("method-picker");
      await userEvent.type(container.querySelector('input[type="password"]')!, "a-new-password");
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));
      await screen.findByTestId("unknown-identifier");

      await userEvent.click(screen.getByRole("button", { name: /use a different email/i }));

      // All the way back to the address, not back to the password step for
      // the address they came here to change.
      expect(await screen.findByLabelText(/email/i)).toBeTruthy();
      expect(screen.queryByTestId("unknown-identifier")).toBeNull();
      expect(screen.queryByTestId("method-picker")).toBeNull();
    });

    /** @scenario Signing in without an account creates it through verification */
    it("keeps the honest failure when the address does have an account", async () => {
      // The router says somebody holds it, both times it is asked, so the
      // refusal really was a wrong password.
      routeMock.mockResolvedValue(localPicker);
      signInMock.mockResolvedValue({
        error: "INVALID_EMAIL_OR_PASSWORD",
        code: "INVALID_EMAIL_OR_PASSWORD",
        status: 401,
      });

      const { container } = renderScreen();
      await enterEmail("sam@example.com");
      await screen.findByTestId("method-picker");

      await userEvent.type(container.querySelector('input[type="password"]')!, "wrong-password");
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));

      expect(await screen.findByText(/invalid email or password/i)).toBeTruthy();
      expect(screen.queryByTestId("unknown-identifier")).toBeNull();
      expect(requestSignUpVerificationMock).not.toHaveBeenCalled();
    });
  });

  describe("when the installation has stopped accepting attempts", () => {
    /** @scenario A rate-limited log-in says how long, and stops asking */
    it("says how long is actually left and disables the submit", async () => {
      routeMock.mockResolvedValue(localPicker);
      signInMock.mockResolvedValue({
        error: "Too many requests",
        status: 429,
        retryAfterSeconds: 120,
      });

      const { container } = renderScreen();
      await enterEmail("sam@example.com");
      await screen.findByTestId("method-picker");

      await userEvent.type(container.querySelector('input[type="password"]')!, "a-password");
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));

      // The anchor's wording stands, and the real remaining window is added to
      // it rather than replacing it with a guess.
      expect(await screen.findByTestId("signin-failure")).toHaveTextContent(/too many attempts/i);
      expect(screen.getByTestId("retry-countdown")).toHaveTextContent("Try again in 2 minutes.");
      expect(screen.getByRole("button", { name: /^log in$/i })).toBeDisabled();
    });

    /** @scenario A rate-limited log-in says how long, and stops asking */
    it("keeps the submit alive when the wait is not known", async () => {
      routeMock.mockResolvedValue(localPicker);
      signInMock.mockResolvedValue({
        error: "Too many requests",
        status: 429,
      });

      const { container } = renderScreen();
      await enterEmail("sam@example.com");
      await screen.findByTestId("method-picker");

      await userEvent.type(container.querySelector('input[type="password"]')!, "a-password");
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));

      expect(await screen.findByTestId("signin-failure")).toHaveTextContent(/too many attempts/i);
      expect(screen.queryByTestId("retry-countdown")).toBeNull();
      expect(screen.getByRole("button", { name: /^log in$/i })).not.toBeDisabled();
    });
  });

  describe("when this browser has signed in before", () => {
    /**
     * The ordering assertion is REVERSED on purpose: ADR-117's 2026-08-25
     * revision makes the list the ACCOUNT's, so promoting the method it last
     * used is the screen agreeing with itself. The badge still says which one.
     */
    /** @scenario The method last used on this device leads, and is badged */
    it("promotes the method it remembers and badges it", async () => {
      window.localStorage.setItem(LAST_USED_METHOD_STORAGE_KEY, oktaMethod.id);
      routeMock.mockResolvedValue({
        outcome: "method_picker",
        methodSet: [passwordMethod, oktaMethod],
        reasonCode: "account_methods",
      } satisfies RoutingDecision);

      renderScreen();
      await enterEmail("sam@example.com");
      await screen.findByTestId("method-picker");

      expect(await screen.findByTestId("last-used-method")).toBeTruthy();
      expect(screen.getAllByTestId("last-used-method")).toHaveLength(1);
      expect(screen.getByRole("button", { name: /continue with okta/i })).toHaveTextContent(
        /last used/i,
      );

      // Okta was named second and is drawn first, because this browser last
      // got in that way. Everything below it keeps the server's order.
      const picker = screen.getByTestId("method-picker");
      const passwordFieldIndex = picker.innerHTML.indexOf('type="password"');
      const oktaIndex = picker.innerHTML.indexOf("Continue with Okta");
      expect(passwordFieldIndex).toBeGreaterThan(-1);
      expect(oktaIndex).toBeLessThan(passwordFieldIndex);
    });

    /** @scenario A local hint never overrules the deployment's own ranking */
    it("keeps the server's order when this browser remembers a method the account no longer holds", async () => {
      window.localStorage.setItem(LAST_USED_METHOD_STORAGE_KEY, "gitlab");
      routeMock.mockResolvedValue({
        outcome: "method_picker",
        methodSet: [passwordMethod, oktaMethod],
        reasonCode: "account_methods",
      } satisfies RoutingDecision);

      renderScreen();
      await enterEmail("sam@example.com");
      const picker = await screen.findByTestId("method-picker");

      // A hint naming something that is not on offer is a stale note, not an
      // instruction: nothing is promoted and nothing is badged.
      expect(screen.queryByTestId("last-used-method")).toBeNull();
      const passwordFieldIndex = picker.innerHTML.indexOf('type="password"');
      const oktaIndex = picker.innerHTML.indexOf("Continue with Okta");
      expect(passwordFieldIndex).toBeLessThan(oktaIndex);
    });

    it("renders without a badge when this browser remembers nothing", async () => {
      routeMock.mockResolvedValue(localPicker);

      renderScreen();
      await enterEmail("sam@example.com");
      await screen.findByTestId("method-picker");

      expect(screen.queryByTestId("last-used-method")).toBeNull();
    });
  });

  describe("when a password manager looks at the fields", () => {
    /** @scenario The address and password fields cooperate with password managers */
    it("spells the address and password fields the way a manager expects", async () => {
      routeMock.mockResolvedValue(localPicker);

      const { container } = renderScreen();

      const addressField = await screen.findByLabelText(/email/i);
      expect(addressField.getAttribute("type")).toBe("email");
      expect(addressField.getAttribute("name")).toBe("email");
      expect(addressField.getAttribute("autocomplete")).toBe("username webauthn");

      await enterEmail("sam@example.com");
      await screen.findByTestId("method-picker");

      // The address is still in the form on the second step, so the pair can
      // be saved and filled.
      const carried = container.querySelector('input[name="email"]');
      expect(carried?.getAttribute("value")).toBe("sam@example.com");
      expect(carried?.getAttribute("autocomplete")).toBe("username");
      expect(container.querySelector('input[type="password"]')?.getAttribute("autocomplete")).toBe(
        "current-password",
      );
    });
  });

  describe("when the local door is asked for by name", () => {
    it("renders the local method set without asking for an address first", async () => {
      searchParamsRef.current = new URLSearchParams("local=1");
      routeMock.mockResolvedValue({
        outcome: "method_picker",
        methodSet: [passwordMethod],
        reasonCode: "break_glass",
      } satisfies RoutingDecision);

      const { container } = renderScreen();

      await screen.findByTestId("method-picker");
      expect(routeMock).toHaveBeenCalledWith({
        identifier: null,
        breakGlass: true,
      });
      expect(container.querySelector('input[type="password"]')).not.toBeNull();
    });

    it("asks for the address in the form, so the emergency door can actually be used", async () => {
      // No address step ran, so without a field of its own this form could
      // only ever post an empty username — a dead emergency door, discovered
      // unusable exactly when the IdP path is broken.
      searchParamsRef.current = new URLSearchParams("local=1");
      routeMock.mockResolvedValue({
        outcome: "method_picker",
        methodSet: [passwordMethod],
        reasonCode: "break_glass",
      } satisfies RoutingDecision);

      renderScreen();
      await screen.findByTestId("method-picker");

      const email = screen.getByLabelText("Email");
      expect(email.getAttribute("type")).toBe("email");
      await userEvent.type(email, "op@selfhosted.example");
      expect((email as HTMLInputElement).value).toBe("op@selfhosted.example");
    });
  });

  describe("when the router says no account holds the address", () => {
    /** @scenario An address with no account carries on as a sign-up */
    it("says so and asks to verify, the way the sign-up door does", async () => {
      routeMock.mockResolvedValue(unknownIdentifier);

      const { container } = renderScreen();
      await enterEmail("nobody@example.com");

      expect(await screen.findByText(/no account for that email address yet/i)).toBeTruthy();
      expect(screen.queryByTestId("method-picker")).toBeNull();
      expect(container.querySelector('input[type="password"]')).toBeNull();
      expect(screen.getByRole("button", { name: /send confirmation link/i })).toBeTruthy();
    });

    /** @scenario An address with no account carries on as a sign-up */
    it("carries the address, so nothing is typed twice", async () => {
      routeMock.mockResolvedValue(unknownIdentifier);

      renderScreen();
      await enterEmail("nobody@example.com");

      expect(await screen.findByTestId("unknown-identifier")).toHaveTextContent(
        "nobody@example.com",
      );
      expect(screen.queryByLabelText(/email/i)).toBeNull();
    });

    /** @scenario No credential is collected until the confirmation link is opened */
    it("mails the proof before collecting any credential", async () => {
      routeMock.mockResolvedValue(unknownIdentifier);
      requestSignUpVerificationMock.mockResolvedValue({ sent: true });

      renderScreen();
      await enterEmail("nobody@example.com");
      await screen.findByTestId("unknown-identifier");

      expect(registerMock).not.toHaveBeenCalled();
      expect(requestSignUpVerificationMock).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: /send confirmation link/i }));

      await waitFor(() =>
        expect(requestSignUpVerificationMock).toHaveBeenCalledWith({
          email: "nobody@example.com",
        }),
      );
      expect(registerMock).not.toHaveBeenCalled();
      expect(await screen.findByTestId("verification-sent")).toHaveTextContent(
        "nobody@example.com",
      );
    });

    /**
     * The router reads the projection and `user.register` the account, so an
     * account the projection lags is invisible to one and plain to the other.
     * "Already registered" used to be a dead end here.
     */
    /** @scenario Sign-up with an address that already has an account becomes a log-in */
    it("becomes the log-in picker when the address turns out to be held", async () => {
      // Mount, then the address (nobody holds it), then the re-ask after
      // `user.register` says otherwise.
      routeMock
        .mockResolvedValueOnce(localPicker)
        .mockResolvedValueOnce(unknownIdentifier)
        .mockResolvedValue(localPicker);
      requestSignUpVerificationMock.mockRejectedValue({
        data: {
          error: {
            code: "email_already_registered",
            httpStatus: 409,
            fault: "customer",
          },
        },
      });

      renderScreen();
      await enterEmail("sam@example.com");
      await screen.findByTestId("unknown-identifier");
      await userEvent.click(screen.getByRole("button", { name: /send confirmation link/i }));

      expect(await screen.findByTestId("method-picker")).toBeTruthy();
      expect(screen.queryByTestId("unknown-identifier")).toBeNull();
    });

    /** @scenario The sign-up door never offers to use a passkey that already exists */
    it("offers no passkey until the emailed proof returns", async () => {
      publicEnvRef.current = { IS_SAAS: true };
      routeMock.mockResolvedValue(unknownIdentifier);

      renderScreen();
      await enterEmail("nobody@example.com");
      await screen.findByTestId("unknown-identifier");

      expect(screen.queryByTestId("passkey-sign-up")).toBeNull();
      expect(screen.queryByTestId("passkey-sign-in")).toBeNull();
    });

    /** @scenario An address with no account carries on as a sign-up */
    it("goes back to the address step for a mistyped address", async () => {
      routeMock.mockResolvedValue(unknownIdentifier);

      renderScreen();
      await enterEmail("nobody@example.com");
      await userEvent.click(await screen.findByRole("button", { name: /use a different email/i }));

      expect(await screen.findByLabelText(/email/i)).toBeTruthy();
      expect(screen.queryByTestId("unknown-identifier")).toBeNull();
    });
  });
});
