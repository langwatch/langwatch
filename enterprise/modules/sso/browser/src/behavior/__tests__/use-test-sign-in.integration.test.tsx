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

  /** @scenario The test sign-in names the connection rather than waiting for routing */
  it("sends the one test sign-in to the connection it was given and changes nothing else", async () => {
    const host = new FakeSsoHost();
    const { result } = renderTestSignIn(host, "conn-registered");

    await act(async () => {
      await result.current.start();
    });

    expect(host.testSignIns).toHaveLength(1);
    expect(host.testSignIns[0]?.connectionId).toBe("conn-registered");
    expect(result.current.failure).toBeNull();
    expect(host.failures).toEqual([]);
    expect(host.acknowledgements).toEqual([]);
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

  /** @scenario "A SAML account-link refusal is explained as a local sign-in failure" */
  it.each(["account_not_linked", "OAuthAccountNotLinked"])(
    "explains %s as ours, without quoting it or blaming the provider",
    (error) => {
      const host = new FakeSsoHost({ query: { error, ssoTest: "conn-1" } });
      const { result } = renderTestSignIn(host);

      expect(result.current.failure?.title).toBe(
        "LangWatch couldn't link that sign-in to your account",
      );
      expect(result.current.failure?.advice).toMatch(/address verified on your LangWatch account/);
      expect(result.current.failure?.detail).toBeNull();
    },
  );

  describe("when the ID token named another issuer and both come back on the page", () => {
    /** @scenario "An ID token from another issuer is refused with both issuers named" */
    it("quotes the issuer the connection expects and the one the provider sent", () => {
      const expected = "https://login.microsoftonline.com/app-tenant/v2.0";
      const received = "https://login.microsoftonline.com/home-tenant/v2.0";
      const host = new FakeSsoHost({
        query: {
          error: "sso_issuer_mismatch",
          ssoTest: "conn-1",
          expected_issuer: expected,
          received_issuer: received,
        },
      });
      const { result } = renderTestSignIn(host);

      expect(result.current.failure?.title).toMatch(/names a different issuer/i);
      expect(result.current.failure?.detail).toContain(`This connection expects: ${expected}`);
      expect(result.current.failure?.detail).toContain(`Your identity provider sent: ${received}`);
      expect(result.current.failure?.advice).toMatch(/not common or organizations/);
    });
  });

  describe("when the issuers on the page are not https addresses", () => {
    it("leaves them out instead of quoting the query string", () => {
      const host = new FakeSsoHost({
        query: {
          error: "sso_issuer_mismatch",
          ssoTest: "conn-1",
          expected_issuer: "javascript:alert(1)",
          received_issuer: "http://login.example/v2.0",
        },
      });
      const { result } = renderTestSignIn(host);

      expect(result.current.failure?.title).toMatch(/names a different issuer/i);
      expect(result.current.failure?.detail).toBeNull();
    });
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
