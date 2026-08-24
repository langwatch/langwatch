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
  startPasswordSignUpMock,
  signInMock,
  replaceMock,
  sessionRef,
  searchParamsRef,
} = vi.hoisted(() => ({
  routeMock: vi.fn(),
  routeErrorRef: { current: null as unknown },
  startPasswordSignUpMock: vi.fn(),
  signInMock: vi.fn(),
  replaceMock: vi.fn(),
  sessionRef: { current: { data: null as unknown } },
  searchParamsRef: { current: new URLSearchParams("") },
}));

vi.mock("~/utils/api", () => ({
  api: {
    frontDoor: {
      route: {
        useMutation: () => ({
          mutateAsync: routeMock,
          isPending: false,
          error: routeErrorRef.current,
        }),
      },
      startPasswordSignUp: {
        useMutation: () => ({
          mutateAsync: startPasswordSignUpMock,
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: true } }),
}));

vi.mock("~/utils/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/auth-client")>();
  return {
    ...actual,
    signIn: signInMock,
    useSession: () => sessionRef.current,
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
    routeErrorRef.current = null;
    sessionRef.current = { data: null };
    searchParamsRef.current = new URLSearchParams("");
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

      expect(
        await screen.findByText(/could not start log-in/i),
      ).toBeTruthy();
      // The retry IS the field. An alert that replaces it leaves somebody
      // holding an apology with nothing to act on.
      expect(await screen.findByLabelText(/email/i)).toBeTruthy();
      expect(
        screen.getByRole("button", { name: /^continue$/i }),
      ).toBeTruthy();
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
    /** @scenario Signing in without an account creates it through verification */
    it("carries the password into a sign-up and says a link is on its way", async () => {
      routeMock.mockResolvedValue(localPicker);
      signInMock.mockResolvedValue({
        error: "INVALID_EMAIL_OR_PASSWORD",
        code: "INVALID_EMAIL_OR_PASSWORD",
        status: 401,
      });
      startPasswordSignUpMock.mockResolvedValue({
        outcome: "verification_sent",
      });

      const { container } = renderScreen();
      await enterEmail("nobody@example.com");
      await screen.findByTestId("method-picker");

      await userEvent.type(
        container.querySelector('input[type="password"]')!,
        "a-new-password",
      );
      await userEvent.click(screen.getByRole("button", { name: /^log in$/i }));

      expect(await screen.findByTestId("verification-sent")).toHaveTextContent(
        /nobody@example\.com/,
      );
      expect(startPasswordSignUpMock).toHaveBeenCalledWith({
        email: "nobody@example.com",
        password: "a-new-password",
      });
      // No refusal is shown on the way: nothing dead-ends here.
      expect(container.textContent).not.toMatch(/invalid email or password/i);
    });

    /** @scenario Signing in without an account creates it through verification */
    it("keeps the honest failure when the address does have an account", async () => {
      routeMock.mockResolvedValue(localPicker);
      signInMock.mockResolvedValue({
        error: "INVALID_EMAIL_OR_PASSWORD",
        code: "INVALID_EMAIL_OR_PASSWORD",
        status: 401,
      });
      startPasswordSignUpMock.mockResolvedValue({ outcome: "account_exists" });

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
      expect(screen.queryByTestId("verification-sent")).toBeNull();
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
    /** @scenario The method last used on this device is badged, never reordered */
    it("badges the method it remembers, in the order the decision named", async () => {
      window.localStorage.setItem(LAST_USED_METHOD_STORAGE_KEY, oktaMethod.id);
      routeMock.mockResolvedValue({
        outcome: "method_picker",
        methodSet: [passwordMethod, oktaMethod],
        reasonCode: "no_domain_match",
      } satisfies RoutingDecision);

      renderScreen();
      await enterEmail("sam@example.com");
      await screen.findByTestId("method-picker");

      expect(await screen.findByTestId("last-used-method")).toBeTruthy();
      expect(screen.getAllByTestId("last-used-method")).toHaveLength(1);
      expect(
        screen.getByRole("button", { name: /continue with okta/i }),
      ).toHaveTextContent(/last used/i);

      // The badge is a label, never an ordering: the password method the
      // decision named first is still first.
      const picker = screen.getByTestId("method-picker");
      const passwordFieldIndex = picker.innerHTML.indexOf('type="password"');
      const oktaIndex = picker.innerHTML.indexOf("Continue with Okta");
      expect(passwordFieldIndex).toBeGreaterThan(-1);
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
  });
});
