/**
 * @vitest-environment jsdom
 *
 * The identifier-first sign-in screen (D13, ADR-117 §6): it renders routing
 * decisions and holds no routing logic, so every case here is "this decision
 * in, this screen out".
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { RoutingDecision, SignInMethod } from "@langwatch/identity";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  routeMock,
  routeErrorRef,
  requestSignUpVerificationMock,
  registerMock,
  addPasskeyMock,
  signInMock,
  replaceMock,
  sessionRef,
  searchParamsRef,
  publicEnvRef,
} = vi.hoisted(() => ({
  routeMock: vi.fn(),
  routeErrorRef: { current: null as unknown },
  requestSignUpVerificationMock: vi.fn(),
  registerMock: vi.fn(),
  addPasskeyMock: vi.fn(),
  signInMock: vi.fn(),
  replaceMock: vi.fn(),
  sessionRef: { current: { data: null as unknown } },
  searchParamsRef: { current: new URLSearchParams("") },
  publicEnvRef: { current: { IS_SAAS: true } as Record<string, unknown> },
}));

vi.mock("~/utils/api", () => ({
  api: {
    auth: {
      route: {
        useMutation: () => ({
          mutateAsync: routeMock,
          isPending: false,
          error: routeErrorRef.current,
        }),
      },
      // Kept in the mock precisely so tests can assert it is NEVER reached.
      // No confirmation link goes out until a credential has been chosen, and
      // this is the call that would send one.
      requestSignUpVerification: {
        useMutation: () => ({
          mutateAsync: requestSignUpVerificationMock,
          mutate: (
            input: { email: string },
            options?: { onSuccess?: () => void },
          ) => {
            void Promise.resolve(requestSignUpVerificationMock(input)).then(
              () => options?.onSuccess?.(),
            );
          },
          isPending: false,
          error: null,
        }),
      },
    },
    // The call that creates the account AND sends its link, on the credential
    // step both doors now end at.
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

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

vi.mock("~/utils/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/auth-client")>();
  return {
    ...actual,
    signIn: signInMock,
    useSession: () => sessionRef.current,
    authClient: {
      ...actual.authClient,
      passkey: { addPasskey: addPasskeyMock },
    },
  };
});

vi.mock("~/utils/browserNavigation", () => ({
  replaceLocation: replaceMock,
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

import { LAST_USED_METHOD_STORAGE_KEY } from "../../logic/lastUsedMethod";
import { IdentifierFirstSignIn } from "../IdentifierFirstSignIn";

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

/** Nobody holds the address. The router's answer, asked either by the address
 *  step or by the password form after a refusal. */
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
  return picker.innerHTML
    .replaceAll(email, "")
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
    requestSignUpVerificationMock.mockRejectedValue(
      new Error("email_already_registered"),
    );
    registerMock.mockResolvedValue({ ok: true });
    routeErrorRef.current = null;
    sessionRef.current = { data: null };
    searchParamsRef.current = new URLSearchParams("");
    publicEnvRef.current = { IS_SAAS: true };
    window.localStorage.clear();
  });

  afterEach(() => cleanup());

  describe("when an address routes to an identity provider", () => {
    /** @scenario The email step renders the routed outcome */
    it("sends the person to the provider the decision named", async () => {
      routeMock.mockResolvedValueOnce(localPicker).mockResolvedValueOnce({
        outcome: "redirect_to_connection",
        connectionId: "org:acme",
        methodSet: [oktaMethod],
        reasonCode: "domain_routed",
      } satisfies RoutingDecision);

      renderScreen();
      await enterEmail("sam@acme.com");

      await waitFor(() => {
        expect(signInMock).toHaveBeenCalledWith("okta", {
          callbackUrl: undefined,
        });
      });
      expect(
        await screen.findByTestId("routed-to-connection"),
      ).toHaveTextContent(/okta/i);
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

      expect(
        await screen.findByRole("button", { name: /continue with okta/i }),
      ).toBeTruthy();
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
        expect(
          container.querySelector('input[type="password"]'),
        ).not.toBeNull();
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

  describe("when two visitors enter a registered and an unregistered address", () => {
    /** @scenario The picker looks the same whether or not my account exists */
    it("renders the same picker, from the same one request, for both", async () => {
      routeMock.mockResolvedValue(localPicker);

      const registered = renderScreen();
      await enterEmail("registered@example.com");
      await screen.findByTestId("method-picker");
      const registeredRequests = routeMock.mock.calls.length;
      const registeredMarkup = pickerMarkup(
        registered.container,
        "registered@example.com",
      );
      cleanup();

      routeMock.mockClear();
      const unknown = renderScreen();
      await enterEmail("nobody@example.com");
      await screen.findByTestId("method-picker");

      expect(routeMock.mock.calls.length).toBe(registeredRequests);
      expect(pickerMarkup(unknown.container, "nobody@example.com")).toBe(
        registeredMarkup,
      );
    });

    it("never says whether an account exists", async () => {
      routeMock.mockResolvedValue(localPicker);

      const { container } = renderScreen();
      await enterEmail("nobody@example.com");
      await screen.findByTestId("method-picker");

      expect(container.textContent).not.toMatch(/no account|not registered/i);
      expect(container.textContent).not.toMatch(
        /already (have|has) an account/i,
      );
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
        await screen.findByText(
          /single sign-on is paused for your organization/i,
        ),
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

      await userEvent.type(
        container.querySelector('input[type="password"]')!,
        "wrong-password",
      );
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));

      expect(
        await screen.findByText(/invalid email or password/i),
      ).toBeTruthy();
      expect(container.textContent).not.toContain("INVALID_EMAIL_OR_PASSWORD");
    });
  });

  describe("when the address typed in has no account at all", () => {
    /**
     * The router is asked three times on this journey: once on mount with no
     * address, once for the address that was typed, and once more by the
     * password form — to tell a wrong password from somebody signing up. Only
     * the last says nobody holds the address.
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
    it("asks for a credential and never banks the password that was typed", async () => {
      refusedForAnUnheldAddress();

      const { container } = renderScreen();
      await enterEmail("nobody@example.com");
      await screen.findByTestId("method-picker");

      await userEvent.type(
        container.querySelector('input[type="password"]')!,
        "a-new-password",
      );
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));

      // The credential step, not a link. A password typed into a field spelled
      // `current-password` must never become an account's password: it was
      // asked for once and held to no length.
      expect(await screen.findByTestId("unknown-identifier")).toHaveTextContent(
        "nobody@example.com",
      );
      expect(
        container.querySelector('input[autocomplete="new-password"]'),
      ).toBeTruthy();
      expect(
        (
          container.querySelector(
            'input[autocomplete="new-password"]',
          ) as HTMLInputElement
        ).value,
      ).toBe("");
      // No refusal is shown on the way: nothing dead-ends here.
      expect(container.textContent).not.toMatch(/invalid email or password/i);
    });

    /** @scenario Converting at the log-in door still asks for the password properly */
    it("asks for the new password twice, and holds it to a length", async () => {
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

      // Empty: what was typed into a field spelled `current-password` did not
      // travel into the field that becomes an account's password.
      const first = container.querySelector(
        'input[autocomplete="new-password"]',
      ) as HTMLInputElement;
      expect(first.value).toBe("");

      // The confirmation arrives with the first keystroke — chosen once, typed
      // twice, which the log-in door's single field never was.
      await userEvent.type(first, "x");
      await waitFor(() =>
        expect(
          container.querySelectorAll('input[autocomplete="new-password"]'),
        ).toHaveLength(2),
      );

      // And held to a length. A single character never reaches the server,
      // where the other test in this block proves a real password does.
      await userEvent.click(
        screen.getByRole("button", { name: /create account/i }),
      );
      expect(registerMock).not.toHaveBeenCalled();
    });

    /** @scenario No confirmation link is sent until a credential has been chosen */
    it("has sent nothing at all while the credential is still being chosen", async () => {
      refusedForAnUnheldAddress();

      const { container } = renderScreen();
      await enterEmail("nobody@example.com");
      await screen.findByTestId("method-picker");
      await userEvent.type(
        container.querySelector('input[type="password"]')!,
        "a-new-password",
      );
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));
      await screen.findByTestId("unknown-identifier");

      // The whole point. Learning that an address is free used to cost the
      // person who owns it a message, because asking for the link WAS how the
      // screen found out.
      expect(requestSignUpVerificationMock).not.toHaveBeenCalled();
      expect(registerMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId("verification-sent")).toBeNull();
    });

    /** @scenario Going back from a sent link returns to the address step */
    it("goes back to the address step when the address was wrong", async () => {
      refusedForAnUnheldAddress();

      const { container } = renderScreen();
      await enterEmail("typo@example.com");
      await screen.findByTestId("method-picker");
      await userEvent.type(
        container.querySelector('input[type="password"]')!,
        "a-new-password",
      );
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));
      await screen.findByTestId("unknown-identifier");

      await userEvent.click(
        screen.getByRole("button", { name: /wrong email\?/i }),
      );

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

      await userEvent.type(
        container.querySelector('input[type="password"]')!,
        "wrong-password",
      );
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));

      expect(
        await screen.findByText(/invalid email or password/i),
      ).toBeTruthy();
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

      await userEvent.type(
        container.querySelector('input[type="password"]')!,
        "a-password",
      );
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));

      // The anchor's wording stands, and the real remaining window is added to
      // it rather than replacing it with a guess.
      expect(await screen.findByTestId("signin-failure")).toHaveTextContent(
        /too many attempts/i,
      );
      expect(screen.getByTestId("retry-countdown")).toHaveTextContent(
        "Try again in 2 minutes.",
      );
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

      await userEvent.type(
        container.querySelector('input[type="password"]')!,
        "a-password",
      );
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));

      expect(await screen.findByTestId("signin-failure")).toHaveTextContent(
        /too many attempts/i,
      );
      expect(screen.queryByTestId("retry-countdown")).toBeNull();
      expect(
        screen.getByRole("button", { name: /^log in$/i }),
      ).not.toBeDisabled();
    });
  });

  describe("when this browser has signed in before", () => {
    /**
     * The ordering assertion here is REVERSED from what it was, deliberately,
     * and it is the one presentation pin this change turns over. It used to
     * assert the badge never reorders — correct while every address saw the
     * same instance-wide list, because reordering it by a local hint would
     * have made the screen differ per browser while the decision behind it did
     * not. ADR-117's 2026-08-25 revision makes the list the ACCOUNT's, so
     * promoting the method that account last used is the screen agreeing with
     * itself. The badge assertions are unchanged: it still says which one.
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
      expect(
        screen.getByRole("button", { name: /continue with okta/i }),
      ).toHaveTextContent(/last used/i);

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
      expect(addressField.getAttribute("autocomplete")).toBe(
        "username webauthn",
      );

      await enterEmail("sam@example.com");
      await screen.findByTestId("method-picker");

      // The address is still in the form on the second step, so the pair can
      // be saved and filled.
      const carried = container.querySelector('input[name="email"]');
      expect(carried?.getAttribute("value")).toBe("sam@example.com");
      expect(carried?.getAttribute("autocomplete")).toBe("username");
      expect(
        container
          .querySelector('input[type="password"]')
          ?.getAttribute("autocomplete"),
      ).toBe("current-password");
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
    /**
     * Types the same password into both boxes of the credential step. The
     * second one is not on screen until the first is used, so it is queried
     * after — see the sign-up screen's copy of this helper.
     */
    const fillPasswordPair = async (
      container: HTMLElement,
      password: string,
    ) => {
      const first = container.querySelector('input[type="password"]');
      await userEvent.type(first as HTMLInputElement, password);
      const both = container.querySelectorAll('input[type="password"]');
      await userEvent.type(both[1] as HTMLInputElement, password);
    };

    /** @scenario An address with no account carries on as a sign-up */
    it("says so and asks for a password, the way the sign-up door does", async () => {
      routeMock.mockResolvedValue(unknownIdentifier);

      const { container } = renderScreen();
      await enterEmail("nobody@example.com");

      expect(
        await screen.findByText(/no account for that email address yet/i),
      ).toBeTruthy();
      expect(screen.queryByTestId("method-picker")).toBeNull();
      // A NEW password — chosen here, typed twice and held to a length. The
      // dead end this outcome removed was a `current-password` box somebody
      // with no account could only fail at, and this is not one.
      const field = container.querySelector('input[type="password"]');
      expect(field?.getAttribute("autocomplete")).toBe("new-password");
    });

    /** @scenario An address with no account carries on as a sign-up */
    it("carries the address, so nothing is typed twice", async () => {
      routeMock.mockResolvedValue(unknownIdentifier);

      renderScreen();
      await enterEmail("nobody@example.com");

      expect(await screen.findByTestId("unknown-identifier")).toHaveTextContent(
        "nobody@example.com",
      );
      expect(await screen.findByTestId("signup-identifier")).toHaveTextContent(
        "nobody@example.com",
      );
    });

    /** @scenario No confirmation link is sent until a credential has been chosen */
    it("mails nothing until the password is submitted", async () => {
      routeMock.mockResolvedValue(unknownIdentifier);

      const { container } = renderScreen();
      await enterEmail("nobody@example.com");
      await screen.findByTestId("unknown-identifier");

      // Standing on the step, having typed nothing: no account, no link.
      expect(registerMock).not.toHaveBeenCalled();
      expect(requestSignUpVerificationMock).not.toHaveBeenCalled();

      await fillPasswordPair(container, "a-strong-enough-password");
      await userEvent.click(
        screen.getByRole("button", { name: /create account/i }),
      );

      // The account and the link are made by the same call, which is what
      // lets sign-up open no session and still send mail.
      await waitFor(() =>
        expect(registerMock).toHaveBeenCalledWith(
          expect.objectContaining({ email: "nobody@example.com" }),
        ),
      );
      expect(requestSignUpVerificationMock).not.toHaveBeenCalled();
      // The same card the other doors end at: to the person waiting, arriving
      // here from the log-in form and from the sign-up form is one thing.
      expect(await screen.findByTestId("verification-sent")).toHaveTextContent(
        "nobody@example.com",
      );
    });

    /**
     * The router reads the identity projection and `user.register` reads the
     * account itself, so an account the projection has not caught up with is
     * invisible to one and plain to the other. The screen used to say both
     * things — "no account for that email yet", then "already registered" —
     * and the second one was a dead end.
     *
     */
    /** @scenario Sign-up with an address that already has an account becomes a log-in */
    it("becomes the log-in picker when the address turns out to be held", async () => {
      // Mount, then the address (nobody holds it), then the re-ask after
      // `user.register` says otherwise.
      routeMock
        .mockResolvedValueOnce(localPicker)
        .mockResolvedValueOnce(unknownIdentifier)
        .mockResolvedValue(localPicker);
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
      await enterEmail("sam@example.com");
      await screen.findByTestId("unknown-identifier");
      await fillPasswordPair(container, "a-strong-enough-password");
      await userEvent.click(
        screen.getByRole("button", { name: /create account/i }),
      );

      expect(await screen.findByTestId("method-picker")).toBeTruthy();
      expect(screen.queryByTestId("unknown-identifier")).toBeNull();
    });

    /** @scenario The sign-up door never offers to use a passkey that already exists */
    it("offers creating a passkey, never using one that already exists", async () => {
      publicEnvRef.current = { IS_SAAS: true, PASSKEYS_ENABLED: true };
      routeMock.mockResolvedValue(unknownIdentifier);

      renderScreen();
      await enterEmail("nobody@example.com");
      await screen.findByTestId("unknown-identifier");

      // Creating one for THIS address, which is the only thing a passkey can
      // honestly do on a screen making a new account.
      expect(screen.getByTestId("passkey-sign-up")).toBeTruthy();
      // Using an existing one signs whoever owns it in, which is not a way to
      // finish making this account — it is a way to end up somebody else.
      expect(screen.queryByTestId("passkey-sign-in")).toBeNull();
    });

    /** @scenario An address with no account carries on as a sign-up */
    it("goes back to the address step for a mistyped address", async () => {
      routeMock.mockResolvedValue(unknownIdentifier);

      renderScreen();
      await enterEmail("nobody@example.com");
      await userEvent.click(
        await screen.findByRole("button", { name: /wrong email\?/i }),
      );

      expect(await screen.findByLabelText(/email/i)).toBeTruthy();
      expect(screen.queryByTestId("unknown-identifier")).toBeNull();
    });
  });
});
