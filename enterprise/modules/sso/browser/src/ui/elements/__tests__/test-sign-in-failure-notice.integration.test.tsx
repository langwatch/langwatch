/**
 * @vitest-environment jsdom
 * What an administrator is told when the test sign-in they were asked to run
 * comes back refused: our words for our refusals, and the provider's own,
 * unchanged, for theirs.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { testSignInFailureFor } from "../../../model/test-sign-in-failure.ts";
import { renderWithSsoHost } from "../../../testing.tsx";
import { TestSignInFailureNotice } from "../test-sign-in-failure-notice.tsx";

afterEach(cleanup);

describe("given a refusal of our own", () => {
  /** @scenario "A test sign-in explains itself on the settings screen" */
  it("says what to fix, and blames nobody's identity provider for it", () => {
    const { container } = renderWithSsoHost(
      <TestSignInFailureNotice
        failure={testSignInFailureFor({ code: "sso_domain_not_verified" })}
      />,
    );

    expect(
      screen.getByText("That address is on a domain this connection hasn't verified"),
    ).toBeTruthy();
    expect(container.textContent).toContain("Claim and verify that domain");
    expect(container.textContent).not.toContain("sent you back with an error");
    expect(screen.queryByTestId("test-sign-in-failure-detail")).toBeNull();
  });

  /** @scenario "The administrator is told the ways out of an address mismatch" */
  it("offers all three ways out of an address mismatch, and names their own address", () => {
    const { container } = renderWithSsoHost(
      <TestSignInFailureNotice
        failure={testSignInFailureFor({
          code: "sso_setup_address_mismatch",
          yourAddress: "ana@acme.com",
        })}
      />,
    );

    expect(container.textContent).toContain("ana@acme.com");
    expect(container.textContent).toContain("Sign in at your identity provider as that address");
    expect(container.textContent).toContain("add the address your provider does use");
    expect(container.textContent).toContain("Verifying the domain also fixes it");
    // The setup screen asked for this sign-in, so it never answers with
    // "this connection is still being set up".
    expect(container.textContent).not.toContain("still being set up");
  });
});

describe("given a refusal from the provider itself", () => {
  /** @scenario "A provider's own error is still quoted verbatim" */
  it("quotes their words unchanged, beside our advice rather than instead of it", () => {
    const { container } = renderWithSsoHost(
      <TestSignInFailureNotice
        failure={testSignInFailureFor({
          code: "access_denied",
          description: "User is not assigned to this application",
        })}
      />,
    );

    expect(screen.getByTestId("test-sign-in-failure-detail").textContent).toBe(
      "access_denied: User is not assigned to this application",
    );
    expect(container.textContent).toContain("These are the provider's own words");
  });
});
