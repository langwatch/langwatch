/**
 * @vitest-environment jsdom
 *
 * What an administrator is shown before they are asked for anything (D09 —
 * see specs/identity/sso-idp-termination.feature).
 *
 * The order on this screen is the order the work happens in: somebody
 * configures an application in THEIR identity provider first, and to do that
 * they need our addresses. A registration form that only asked them questions
 * would send them away to guess, and what they would guess is ours — which is
 * why the assertion below is about position, not merely presence.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setupRef, hasPermissionMock } = vi.hoisted(() => ({
  setupRef: { current: undefined as unknown },
  hasPermissionMock: vi.fn(),
}));

vi.mock("~/features/errors/logic/presentation", () => ({
  explainAnyError: () => ({ title: "t", describe: () => "d" }),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ hasPermission: hasPermissionMock }),
}));

vi.mock("../../../utils/api", () => {
  const mutation = () => ({
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  });
  const emptyQuery = {
    useQuery: () => ({ data: [], isLoading: false, error: null }),
  };
  return {
    api: {
      ssoSetup: {
        getSetup: {
          useQuery: () => ({ isLoading: false, data: setupRef.current }),
        },
        register: mutation(),
        proveDomain: mutation(),
        checkDomainRecord: mutation(),
        claimDomain: mutation(),
        activate: mutation(),
        grantBreakGlass: mutation(),
        renewBreakGlass: mutation(),
        breakGlassBindings: emptyQuery,
        breakGlassCandidates: emptyQuery,
      },
      useUtils: () => ({
        ssoSetup: {
          getSetup: { invalidate: vi.fn() },
          breakGlassBindings: { invalidate: vi.fn() },
        },
      }),
    },
  };
});

vi.mock("../../../utils/auth-client", () => ({
  authClient: { signIn: { sso: vi.fn() } },
}));

import { SingleSignOnSetup } from "../SingleSignOnSetup";

const SERVICE_PROVIDER = {
  redirectUrl: "https://app.test/api/auth/sso/callback/{connection}",
  assertionConsumerServiceUrl:
    "https://app.test/api/auth/sso/saml2/sp/acs/{connection}",
  singleLogoutUrl: "https://app.test/api/auth/sso/saml2/sp/slo/{connection}",
  entityId: "https://app.test/api/auth/sso/saml2/sp",
  metadataUrl:
    "https://app.test/api/auth/sso/saml2/sp/metadata?providerId={connection}",
};

const renderSetup = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SingleSignOnSetup organizationId="org_acme" />
    </ChakraProvider>,
  );

describe("given an organization that may set single sign-on up and has no connection", () => {
  beforeEach(() => {
    hasPermissionMock.mockReturnValue(true);
    setupRef.current = {
      availability: { available: true, proof: "dns-record" },
      serviceProvider: SERVICE_PROVIDER,
      connection: null,
      claims: [],
      record: null,
      attestationOffered: false,
    };
  });

  afterEach(cleanup);

  /**
   * The screen opens on the grid of identity providers, so the addresses and
   * the fields are about a provider somebody has named. Okta's default
   * protocol is OpenID Connect, and picking a PRODUCT leaves the protocol
   * cards on screen — a preset pre-answers that question, it does not close
   * it.
   */
  const pickOkta = () =>
    fireEvent.click(screen.getByTestId("identity-provider-okta"));

  /** @scenario "LangWatch's own details are shown before the identity provider's are asked for" */
  it("shows the chosen protocol's addresses, and shows them above the fields to fill in", () => {
    const { container } = renderSetup();
    pickOkta();

    // OpenID Connect is the default choice, and it needs exactly one of our
    // addresses. The other protocol's three are not a wall of URLs behind it.
    expect(screen.getByText(SERVICE_PROVIDER.redirectUrl)).toBeDefined();
    expect(
      screen.queryByText(SERVICE_PROVIDER.assertionConsumerServiceUrl),
    ).toBeNull();

    const ours = container.textContent?.indexOf(
      "Set LangWatch up in your identity provider",
    );
    const theirs = container.textContent?.indexOf(
      "Then bring back what Okta gives you",
    );
    expect(ours).toBeGreaterThanOrEqual(0);
    expect(theirs).toBeGreaterThan(ours ?? 0);
  });

  /** @scenario "LangWatch's own details are shown before the identity provider's are asked for" */
  it("shows the SAML addresses once SAML is chosen, and only those", () => {
    renderSetup();

    fireEvent.click(screen.getByRole("radio", { name: /SAML/ }));

    expect(
      screen.getByText(SERVICE_PROVIDER.assertionConsumerServiceUrl),
    ).toBeDefined();
    expect(screen.getByText(SERVICE_PROVIDER.entityId)).toBeDefined();
    expect(screen.getByText(SERVICE_PROVIDER.metadataUrl)).toBeDefined();
    expect(screen.queryByText(SERVICE_PROVIDER.redirectUrl)).toBeNull();
  });

  /** @scenario "The administrator chooses which kind of provider they have" */
  it("offers both protocols by name, described by what the administrator holds", () => {
    renderSetup();
    pickOkta();

    // Named by protocol — the word their identity provider's console uses —
    // and described by what they HAVE, because somebody handed a metadata
    // file by their security team does not necessarily know it is called
    // SAML.
    expect(
      screen.getByRole("radio", {
        name: /OpenID Connect.*client id and a client secret/,
      }),
    ).toBeDefined();
    expect(
      screen.getByRole("radio", {
        name: /SAML.*metadata file, or a sign-in address and a certificate/,
      }),
    ).toBeDefined();
  });

  /** @scenario "The administrator chooses which kind of provider they have" */
  it("asks for an issuer, a client id and a client secret by default", () => {
    renderSetup();
    pickOkta();

    expect(screen.getByLabelText("Issuer address")).toBeDefined();
    expect(screen.getByLabelText("Client id")).toBeDefined();
    expect(screen.getByLabelText("Client secret")).toBeDefined();
  });

  /** @scenario "The administrator chooses which kind of provider they have" */
  it("asks for metadata, or a sign-in address and certificate, once SAML is chosen", () => {
    renderSetup();

    fireEvent.click(screen.getByRole("radio", { name: /SAML/ }));

    expect(screen.getByLabelText("Sign-in address")).toBeDefined();
    expect(screen.getByLabelText("Metadata")).toBeDefined();
    expect(screen.getByLabelText("Entity id")).toBeDefined();
    expect(screen.getByLabelText("Signing certificate")).toBeDefined();
  });
});

describe("given a reader who may not manage single sign-on", () => {
  beforeEach(() => {
    hasPermissionMock.mockReturnValue(false);
    setupRef.current = {
      availability: { available: true, proof: "dns-record" },
      serviceProvider: SERVICE_PROVIDER,
      connection: null,
      claims: [],
      record: null,
      attestationOffered: false,
    };
  });

  afterEach(cleanup);

  /** @scenario "A reader who may not manage single sign-on is offered no form" */
  it("offers no registration form at all", () => {
    const { container } = renderSetup();

    // A disabled control is still an invitation, and inviting somebody to do
    // a thing they will be refused for is worse than not offering it.
    expect(container.textContent).not.toContain("Then tell us about it");
  });
});
