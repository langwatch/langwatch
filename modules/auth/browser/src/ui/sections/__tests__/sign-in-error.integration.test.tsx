import { signInErrorMayCross } from "@langwatch/auth-contract";
/**
 * @vitest-environment jsdom
 * Sign-in error UI; regression: federated logout on account collision
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { WithTestAuthHost } from "../../../testing.tsx";
import { FEDERATED_LOGOUT_PATH, SignInError } from "../sign-in-error-screen.tsx";

function renderError(error: string, extra: Record<string, string> = {}) {
  return render(
    <MemoryRouter initialEntries={[`/auth/error?error=${error}`]}>
      <DesignSystemProvider forcedTheme="light">
        <WithTestAuthHost route={{ pathname: "/auth/error", query: { error, ...extra } }}>
          <SignInError error={error} />
        </WithTestAuthHost>
      </DesignSystemProvider>
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());

describe("<SignInError/>", () => {
  describe("when an account already exists under a different sign-in method", () => {
    it("shows the 'Account already exists' heading", () => {
      renderError("OAuthAccountNotLinked");
      expect(screen.getByText("Account already exists")).toBeTruthy();
    });

    it("recovers via a federated logout, not a bare bounce back to sign-in", () => {
      renderError("OAuthAccountNotLinked");
      const recovery = screen.getByRole("link", {
        name: /sign out.*try again/i,
      });
      expect(recovery.getAttribute("href")).toBe(FEDERATED_LOGOUT_PATH);
      // The old behaviour linked straight to /auth/signin, which re-auths the
      // still-live IdP session and re-triggers the same failure (the loop).
      expect(recovery.getAttribute("href")).not.toContain("/auth/signin");
    });

    it("steers the user to sign out and use their original / SSO method", () => {
      renderError("OAuthAccountNotLinked");
      expect(screen.getByText(/provider didn't confirm the address/i)).toBeTruthy();
      expect(screen.getByText(/method you used before/i)).toBeTruthy();
    });
  });

  describe("when single sign-on meets a confirmed account on a domain the connection has not verified", () => {
    /** @scenario "A confirmed account on a domain the connection has not verified is refused with the missing proof named" */
    it("names the domain proof that is missing, not another sign-in method", () => {
      renderError("sso_domain_not_verified");

      expect(document.body.textContent).toMatch(/domain verification|verify the domain/i);
      expect(screen.queryByText("Account already exists")).toBeNull();
      expect(screen.queryByText(/method you used before/i)).toBeNull();
    });
  });

  describe("when the organization enforces SSO and the wrong method was used", () => {
    it("shows a friendly heading instead of the raw error code", () => {
      renderError("SSO_PROVIDER_NOT_ALLOWED");
      expect(screen.getByText(/use your organization's sign-in/i)).toBeTruthy();
      expect(screen.queryByText("SSO_PROVIDER_NOT_ALLOWED")).toBeNull();
    });

    it("recovers via a federated logout so the next attempt can pick SSO", () => {
      renderError("SSO_PROVIDER_NOT_ALLOWED");
      const recovery = screen.getByRole("link", {
        name: /sign out.*try again/i,
      });
      expect(recovery.getAttribute("href")).toBe(FEDERATED_LOGOUT_PATH);
    });
  });

  describe("when linking is refused due to a different email (settings flow)", () => {
    it("keeps the user in settings rather than offering a logout", () => {
      renderError("DIFFERENT_EMAIL_NOT_ALLOWED");
      expect(screen.getByText(/can't link this account/i)).toBeTruthy();
      const back = screen.getByRole("link", { name: /back to settings/i });
      expect(back.getAttribute("href")).toBe("/settings/authentication");
    });
  });
});

describe("given somebody opens the sign-in error screen with a description of their own", () => {
  /** @scenario "A description supplied by the caller is never echoed" */
  it("shows neither the supplied description nor a supplied code", () => {
    const planted = "Your account was suspended. Call +1-555-0100 to restore it.";
    renderError("ACCOUNT_SEIZED_CONTACT_SUPPORT", { error_description: planted });

    expect(document.body.textContent).not.toContain("555-0100");
    expect(document.body.textContent).not.toContain("ACCOUNT_SEIZED_CONTACT_SUPPORT");
    expect(screen.getAllByText(/Something went wrong signing you in/i).length).toBeGreaterThan(0);
  });
});

describe("given a failure whose cause was withheld", () => {
  /** @scenario "An unhandled failure crosses as one generic code" */
  /** @scenario "The cause is written down where we can read it" */
  it("says something went wrong and shows the trace id to quote", () => {
    renderError("sign_in_failed", { trace: "trace_abc123" });

    expect(screen.getAllByText(/Something went wrong signing you in/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId("sign-in-error-trace").textContent).toContain("trace_abc123");
  });

  it("shows no reference when there is none to show", () => {
    renderError("sign_in_failed");

    expect(screen.queryByTestId("sign-in-error-trace")).toBeNull();
  });
});

describe("given a sign-in refused because an unconfirmed account holds the address", () => {
  /** @scenario "The refusal reaches the sign-in screen with words the reader can act on" */
  it("crosses the boundary as itself and says how to get in", () => {
    expect(signInErrorMayCross("sso_existing_account_unconfirmed")).toBe(true);

    renderError("sso_existing_account_unconfirmed");

    expect(screen.getByText(/An account with this address already exists/i)).toBeTruthy();
    expect(screen.getByText(/Sign in the way you did before/i)).toBeTruthy();
    expect(screen.queryAllByText(/Something went wrong signing you in/i)).toHaveLength(0);
  });
});

describe("given one of the assertion refusals the boundary admits", () => {
  /** @scenario "A handled refusal crosses with its own code" */
  it("renders the words the registry holds for it, not the generic line", () => {
    renderError("sso_setup_address_mismatch");

    expect(screen.getByText("That sign-in came from a different address")).toBeTruthy();
    expect(screen.queryAllByText(/Something went wrong signing you in/i)).toHaveLength(0);
  });

  it.each([
    "sso_sign_in_refused",
    "sso_assertion_without_address",
    "sso_domain_not_verified",
    "sso_domain_proof_lapsed",
  ])("gives %s its own words", (code) => {
    renderError(code);

    expect(screen.queryAllByText(/Something went wrong signing you in/i)).toHaveLength(0);
  });

  it("still refuses a registered code the boundary would not admit", () => {
    renderError("validation_error");

    expect(screen.getAllByText(/Something went wrong signing you in/i).length).toBeGreaterThan(0);
  });
});
