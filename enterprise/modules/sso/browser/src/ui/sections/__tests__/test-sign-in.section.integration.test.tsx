/**
 * @vitest-environment jsdom
 * The step that proves the connection carries a real person.
 * Spec: specs/identity/sso-activation.feature.
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { FakeSsoHost, renderWithSsoHost } from "../../../testing.tsx";
import { TestSignInSection } from "../test-sign-in.section.tsx";

function renderSection(
  overrides: {
    canManage?: boolean;
    done?: boolean;
    atMs?: number | null;
    connectionState?: string;
    verifiedDomains?: string[];
  } = {},
  host: FakeSsoHost = new FakeSsoHost(),
) {
  return renderWithSsoHost(
    <TestSignInSection
      connectionId="conn-1"
      providerName="Acme Okta"
      canManage={overrides.canManage ?? true}
      testSignIn={{ done: overrides.done ?? false, atMs: overrides.atMs ?? null }}
      connectionState={overrides.connectionState ?? "VERIFIED"}
      verifiedDomains={overrides.verifiedDomains ?? []}
    />,
    host,
  );
}

afterEach(cleanup);

describe("given an administrator on the setup page", () => {
  /** @scenario "The test sign-in is offered on the setup screen once a provider is registered" */
  it("offers the test, and says it signs them in through their own provider", () => {
    renderSection();

    expect(screen.getByTestId("test-sign-in-start").textContent).toContain("Test sign-in");
    expect(screen.getByText(/This sends you to Acme Okta to sign in/)).toBeTruthy();
  });

  /** @scenario "The test says it will replace this session before it is pressed" */
  it("says a success replaces this session, before the button is pressed", () => {
    renderSection();
    const note = screen.getByTestId("test-sign-in-session-note").textContent ?? "";

    expect(note).toContain("replaces the session you are reading this with");
    expect(note).toContain("you come back as them");
    expect(note).toContain("the way back to your own account");
  });

  /** @scenario "The test says it will replace this session before it is pressed" */
  it("says it before the control, where it can still change what they do", () => {
    renderSection();
    const note = screen.getByTestId("test-sign-in-session-note");
    const control = screen.getByTestId("test-sign-in-start");

    expect(note.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names the one address a connection still being set up will accept", () => {
    renderSection({ connectionState: "VERIFIED", verifiedDomains: ["acme.com"] });

    expect(screen.getByTestId("test-sign-in-address-note").textContent).toContain("ana@acme.com");
  });

  it("hands the browser to the provider, marked as this test's return", async () => {
    const host = new FakeSsoHost({ query: { tab: "sso" } });
    renderSection({}, host);
    await userEvent.click(screen.getByTestId("test-sign-in-start"));

    expect(host.testSignIns).toEqual([
      { connectionId: "conn-1", callbackQuery: { tab: "sso", ssoTest: "conn-1" } },
    ]);
  });

  it("shows what came back rather than a toast that is already gone", async () => {
    const host = new FakeSsoHost({ testSignIn: { error: { code: "invalid_client" } } });
    renderSection({}, host);
    await userEvent.click(screen.getByTestId("test-sign-in-start"));

    await waitFor(() => expect(screen.getByTestId("test-sign-in-failure")).toBeTruthy());
    expect(screen.getByTestId("test-sign-in-start").textContent).toContain("Try the sign-in again");
  });
});

describe("given a connection a sign-in has already worked through", () => {
  it("says so, and when, and still offers another go", () => {
    renderSection({ done: true, atMs: Date.UTC(2026, 1, 9, 12, 30) });

    expect(screen.getByText("A sign-in through this connection worked")).toBeTruthy();
    expect(screen.getByText(/The last one was on 9 February 2026/)).toBeTruthy();
    expect(screen.getByTestId("test-sign-in-start").textContent).toContain("Test it again");
  });
});

describe("given a reader who may not manage single sign-on", () => {
  it("explains the step and offers no way to run it", () => {
    renderSection({ canManage: false });

    expect(screen.getByTestId("test-sign-in-session-note")).toBeTruthy();
    expect(screen.queryByTestId("test-sign-in-start")).toBeNull();
  });
});
