/**
 * @vitest-environment jsdom
 * The values an administrator pastes into their own identity provider: the
 * chosen protocol's and no others, each with a way to take it without
 * retyping it, and the placeholder said out loud before it is filled in.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ServiceProviderAddresses } from "../../../model/service-provider-rows.ts";
import { renderWithSsoHost } from "../../../testing.tsx";
import { ServiceProviderSection } from "../service-provider.section.tsx";

const ADDRESSES: ServiceProviderAddresses = {
  redirectUrl: "https://app.langwatch.ai/api/auth/sso/callback/{connection}",
  assertionConsumerServiceUrl: "https://app.langwatch.ai/api/auth/sso/saml2/sp/acs/{connection}",
  entityId: "https://app.langwatch.ai/api/auth/sso/saml2/sp/entity/{connection}",
  metadataUrl: "https://app.langwatch.ai/api/auth/sso/saml2/sp/metadata/{connection}",
};

const renderSection = (overrides: { protocol?: "oidc" | "saml"; connected?: boolean } = {}) =>
  renderWithSsoHost(
    <ServiceProviderSection
      protocol={overrides.protocol ?? "oidc"}
      addresses={ADDRESSES}
      connected={overrides.connected ?? false}
    />,
  );

afterEach(cleanup);

describe("given an administrator setting up OpenID Connect", () => {
  /** @scenario "LangWatch's own details are shown before the identity provider's are asked for" */
  it("shows the redirect address alone, and offers to copy it", () => {
    renderSection({ protocol: "oidc" });

    expect(screen.getByText(ADDRESSES.redirectUrl)).toBeTruthy();
    expect(screen.queryByText(ADDRESSES.entityId)).toBeNull();
    expect(screen.getByRole("button", { name: "Copy Redirect address" })).toBeTruthy();
  });

  it("says the addresses are ours and do not change, in the singular", () => {
    const { container } = renderSection({ protocol: "oidc" });

    expect(container.textContent).toContain("give it this address");
  });
});

describe("given an administrator setting up SAML", () => {
  /** @scenario "LangWatch's own details are shown before the identity provider's are asked for" */
  it("shows the assertion address, the entity id and the metadata address, and no redirect", () => {
    renderSection({ protocol: "saml" });

    expect(screen.getByText(ADDRESSES.assertionConsumerServiceUrl)).toBeTruthy();
    expect(screen.getByText(ADDRESSES.entityId)).toBeTruthy();
    expect(screen.getByText(ADDRESSES.metadataUrl)).toBeTruthy();
    expect(screen.queryByText(ADDRESSES.redirectUrl)).toBeNull();
  });

  it("says what each value is for, so none of them is pasted by guess", () => {
    const { container } = renderSection({ protocol: "saml" });

    expect(container.textContent).toContain("Where your identity provider posts the signed");
    expect(container.textContent).toContain("What to call LangWatch in your identity provider");
  });
});

describe("given an organization with no connection registered yet", () => {
  // An administrator who pastes one of these before registering has pointed
  // their provider at a connection that does not exist.
  it("says the placeholder is filled in by registering, and to come back for it", () => {
    const { container } = renderSection({ connected: false });

    expect(container.textContent).toContain("{connection}");
    expect(container.textContent).toContain("come back for the finished address");
  });

  it("stops saying it once a connection exists", () => {
    const { container } = renderSection({ connected: true });

    expect(container.textContent).not.toContain("come back for the finished");
  });
});
