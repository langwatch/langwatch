/**
 * @vitest-environment jsdom
 * Which sentence an inline refusal leads with: the act it names is ONLY the
 * fallback, because rendering it over the registry's own title left the two
 * halves of one alert describing two different failures.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithSsoHost } from "../../../testing.tsx";
import { InlineRefusal, LoadFailure } from "../refusals.tsx";

/**
 * The wire shape a tRPC refusal arrives in — `data.error` carrying a `code`
 * and an `httpStatus`, which is what the registry reading reads. Built here
 * rather than mocked, so this test fails if that reading changes.
 */
function handledRefusal(code: string) {
  return {
    data: {
      error: {
        code,
        kind: code,
        httpStatus: 422,
        fault: "customer",
        meta: {},
        reasons: [{ code: "unknown", kind: "unknown" }],
      },
    },
  };
}

afterEach(cleanup);

describe("given a refusal the registry has copy for", () => {
  it("leads with the registered title rather than the act it was given", () => {
    renderWithSsoHost(
      <InlineRefusal
        error={handledRefusal("sso_issuer_unreachable")}
        what="Registering that connection"
      />,
    );

    expect(screen.getByText("The identity provider could not be reached")).toBeTruthy();
    expect(screen.queryByText(/Registering that connection didn't work/)).toBe(null);
  });

  it("keeps the title and the description describing the same failure", () => {
    renderWithSsoHost(
      <InlineRefusal
        error={handledRefusal("sso_issuer_unreachable")}
        what="Registering that connection"
      />,
    );

    expect(screen.getByText(/discovery document at the issuer address/)).toBeTruthy();
    expect(screen.getByText("The identity provider could not be reached")).toBeTruthy();
  });
});

describe("given a failure with no registered copy", () => {
  it("names the act, which says more than the unknown title would", () => {
    renderWithSsoHost(
      <InlineRefusal error={new Error("connection reset")} what="Registering that connection" />,
    );

    expect(screen.getByText("Registering that connection didn't work")).toBeTruthy();
  });

  it("falls back to the unknown title when no act was named", () => {
    renderWithSsoHost(<InlineRefusal error={new Error("connection reset")} />);

    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });
});

describe("given no error at all", () => {
  it("renders nothing", () => {
    renderWithSsoHost(<InlineRefusal error={null} />);

    expect(screen.queryByTestId("sso-inline-refusal")).toBe(null);
  });
});

describe("given a read that failed", () => {
  it("says what could not be loaded, rather than leaving an empty panel", () => {
    renderWithSsoHost(<LoadFailure error={new Error("offline")} what="your sign-in history" />);

    expect(screen.getByTestId("sso-load-failure")).toBeTruthy();
    expect(screen.getByText(/We could not load your sign-in history\./)).toBeTruthy();
  });
});
