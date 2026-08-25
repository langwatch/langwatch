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
import { cleanup, render, screen } from "@testing-library/react";
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

  /** @scenario "LangWatch's own details are shown before the identity provider's are asked for" */
  it("shows LangWatch's addresses, and shows them above the fields to fill in", () => {
    const { container } = renderSetup();

    const values = [...container.querySelectorAll("input")].map(
      (input) => (input as HTMLInputElement).value,
    );
    expect(values).toContain(SERVICE_PROVIDER.redirectUrl);
    expect(values).toContain(SERVICE_PROVIDER.assertionConsumerServiceUrl);
    expect(values).toContain(SERVICE_PROVIDER.entityId);

    const ours = container.textContent?.indexOf(
      "Set LangWatch up in your identity provider",
    );
    const theirs = container.textContent?.indexOf("Then tell us about it");
    expect(ours).toBeGreaterThanOrEqual(0);
    expect(theirs).toBeGreaterThan(ours ?? 0);
  });

  /** @scenario "The administrator chooses which kind of provider they have" */
  it("offers both kinds of provider in the customer's own words", () => {
    renderSetup();

    // Named by what the administrator HAS, not by the protocol: somebody
    // handed a metadata file by their security team does not necessarily
    // know it is called SAML.
    expect(
      screen.getByRole("option", {
        name: "I have a client id and a client secret",
      }),
    ).toBeDefined();
    expect(
      screen.getByRole("option", {
        name: "I have my identity provider's metadata",
      }),
    ).toBeDefined();
  });

  /** @scenario "The administrator chooses which kind of provider they have" */
  it("asks for an issuer, a client id and a client secret by default", () => {
    const { container } = renderSetup();

    const placeholders = [...container.querySelectorAll("input, textarea")].map(
      (field) => field.getAttribute("placeholder"),
    );
    expect(placeholders).toContain("Issuer address");
    expect(placeholders).toContain("Client id");
    expect(placeholders).toContain("Client secret");
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
