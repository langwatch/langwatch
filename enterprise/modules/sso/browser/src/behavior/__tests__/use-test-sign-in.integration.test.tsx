/**
 * @vitest-environment jsdom
 * Starting a test sign-in through the host, and reading what came back on the
 * address bar. Spec: specs/identity/sso-assertion-refusals.feature.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { SsoHostProvider } from "../../model/sso-host.ts";
import { FakeSsoHost } from "../../testing.tsx";
import { useTestSignIn } from "../use-test-sign-in.ts";

function renderTestSignIn(host: FakeSsoHost, connectionId = "conn-1") {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SsoHostProvider value={host}>{children}</SsoHostProvider>
  );

  return renderHook(() => useTestSignIn({ connectionId }), { wrapper });
}

afterEach(cleanup);

describe("when the administrator presses the control", () => {
  it("asks for a way back to this page, marked as this test's", async () => {
    const host = new FakeSsoHost({
      query: { view: "sso", error: "access_denied", error_description: "stale", ssoTest: "conn-9" },
    });
    const { result } = renderTestSignIn(host);

    await act(async () => {
      await result.current.start();
    });

    expect(host.testSignIns).toEqual([
      { connectionId: "conn-1", callbackQuery: { view: "sso", ssoTest: "conn-1" } },
    ]);
    expect(result.current.sending).toBe(false);
  });

  it("quotes a refusal that arrived before the browser ever left", async () => {
    const host = new FakeSsoHost({
      testSignIn: {
        error: { code: "invalid_client", message: "no such application", status: 400 },
      },
    });
    const { result } = renderTestSignIn(host);

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.failure?.title).toBe("That sign-in didn't complete");
    expect(result.current.failure?.detail).toBe(
      "invalid_client — no such application — (status 400)",
    );
  });

  it("says so rather than reporting a sign-in nobody ran as a success", async () => {
    const host = new FakeSsoHost({ testSignIn: new Error("no test sign-in in this composition") });
    const { result } = renderTestSignIn(host);

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.failure?.detail).toBe("no test sign-in in this composition");
  });
});

describe("when the provider sends the browser back", () => {
  /** @scenario "A test sign-in explains itself on the settings screen" */
  it("reads our own refusal as ours, in words that name what to fix", () => {
    const host = new FakeSsoHost({
      query: { error: "sso_setup_address_mismatch", ssoTest: "conn-1" },
    });
    const { result } = renderTestSignIn(host);

    expect(result.current.failure?.title).toBe(
      "Your identity provider signed you in as a different address",
    );
    expect(result.current.failure?.detail).toBeNull();
    expect(result.current.failure?.advice).toContain("ana@acme.com");
  });

  /** @scenario "A provider's own error is still quoted verbatim" */
  it("hands over the provider's own words unchanged", () => {
    const host = new FakeSsoHost({
      query: { error: "access_denied", error_description: "AADSTS50105", ssoTest: "conn-1" },
    });
    const { result } = renderTestSignIn(host);

    expect(result.current.failure?.title).toBe(
      "Your identity provider sent you back with an error",
    );
    expect(result.current.failure?.detail).toBe("access_denied: AADSTS50105");
  });

  it("spells a code the engine emits under two names the one way", () => {
    const host = new FakeSsoHost({ query: { error: "account_not_linked", ssoTest: "conn-1" } });
    const { result } = renderTestSignIn(host);

    expect(result.current.failure?.title).toBe(
      "LangWatch couldn't link that sign-in to your account",
    );
  });

  it("leaves an error belonging to another flow alone", () => {
    const someoneElses = new FakeSsoHost({ query: { error: "access_denied", ssoTest: "conn-9" } });
    const unmarked = new FakeSsoHost({ query: { error: "access_denied" } });

    expect(renderTestSignIn(someoneElses).result.current.failure).toBeNull();
    expect(renderTestSignIn(unmarked).result.current.failure).toBeNull();
  });

  it("puts the verdict away when it is dismissed", () => {
    const host = new FakeSsoHost({
      query: { error: "sso_domain_not_verified", ssoTest: "conn-1" },
    });
    const { result } = renderTestSignIn(host);

    expect(result.current.failure).not.toBeNull();
    act(() => {
      result.current.dismissFailure();
    });

    expect(result.current.failure).toBeNull();
  });
});
