/**
 * @vitest-environment jsdom
 * What an organization already signing in through a pre-connection route is
 * told: that it is set up, on which domain, and never the stored identifier
 * of a provider we cannot spell.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithSsoHost } from "../../../testing.tsx";
import { LegacyRouteNotice } from "../legacy-route-notice.tsx";

afterEach(cleanup);

describe("the legacy route notice", () => {
  it("says the setup exists and names the domain it answers", () => {
    const { container } = renderWithSsoHost(
      <LegacyRouteNotice legacyRoute={{ domain: "acme.test", provider: "auth0" }} />,
    );

    expect(container.textContent).toContain("Single sign-on is already set up");
    expect(container.textContent).toContain("acme.test");
    expect(container.textContent).toContain("Auth0");
    expect(screen.getByTestId("sso-legacy-route")).toBeTruthy();
  });

  it("offers nothing to press, so nobody builds a rival to the live route", () => {
    renderWithSsoHost(
      <LegacyRouteNotice legacyRoute={{ domain: "acme.test", provider: "auth0" }} />,
    );

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("leaves the provider row out rather than showing an identifier it cannot spell", () => {
    const { container } = renderWithSsoHost(
      <LegacyRouteNotice legacyRoute={{ domain: "acme.test", provider: "acme-internal" }} />,
    );

    expect(container.textContent).not.toContain("acme-internal");
    expect(container.textContent).not.toContain("Identity provider");
  });
});
