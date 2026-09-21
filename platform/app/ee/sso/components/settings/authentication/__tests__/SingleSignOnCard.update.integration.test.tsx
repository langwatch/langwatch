/**
 * @vitest-environment jsdom
 *
 * What the Authentication overview says about an organization whose single
 * sign-on LangWatch set up, and about one that is replacing it (ADR-124 §6).
 *
 * The overview is where an administrator who never opens the provider page
 * finds out that connecting their own identity provider is theirs to do — so
 * the notice and its one action are asserted here, and so is the rule that
 * the action is only ever offered to somebody who could act on it.
 *
 * Spec: specs/identity/sso-idp-termination.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { SelfServeSetupView } from "@ee/sso/sso-self-serve.types";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@ee/sso/hooks/useTestSignIn", () => ({
  useTestSignIn: () => ({ start: vi.fn(), sending: false, failure: null }),
}));

import { SingleSignOnCard } from "../SingleSignOnCard";

const SERVICE_PROVIDER = {
  redirectUrl: "https://app.test/api/auth/sso/callback/ssoc_legacy",
  assertionConsumerServiceUrl: "https://app.test/acs",
  singleLogoutUrl: "https://app.test/slo",
  entityId: "https://app.test/api/auth/sso/saml2/sp",
  metadataUrl: "https://app.test/metadata",
};

function setupWith({
  source = "legacy-grandfathered",
  migration = null,
}: {
  source?: "legacy-grandfathered" | "self-serve";
  migration?: SelfServeSetupView["migration"];
} = {}) {
  const connection = {
    connectionId: "ssoc_legacy",
    state: "ACTIVE" as const,
    type: "oidc" as const,
    providerId: "auth0",
    issuer: "https://acme.eu.auth0.com",
    source,
    replacesConnectionId: null,
    migrationPhase: null,
    arrivalPolicy: "admit" as const,
    tearDownAfterMs: null,
    verifiedDomains: ["acme.com"],
    domainProofs: [],
  };
  return {
    availability: { available: true as const, proof: "dns-record" as const },
    serviceProvider: SERVICE_PROVIDER,
    serviceProviderBeforeRegistration: SERVICE_PROVIDER,
    connection,
    legacyRoute: null,
    claims: [],
    record: null,
    goLive: null,
    migration,
    attestationOffered: false as const,
  } as unknown as SelfServeSetupView & {
    connection: NonNullable<SelfServeSetupView["connection"]>;
  };
}

function renderCard({
  setup = setupWith(),
  canManage = true,
}: {
  setup?: ReturnType<typeof setupWith>;
  canManage?: boolean;
} = {}) {
  return render(
    <MemoryRouter>
      <ChakraProvider value={defaultSystem}>
        <SingleSignOnCard setup={setup} canManage={canManage} />
      </ChakraProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given single sign-on LangWatch set up for the organization", () => {
  describe("when an administrator opens Authentication", () => {
    /** @scenario "An organization is offered its own identity provider on the Authentication overview" */
    it("says they can connect their own, with one action that goes there", () => {
      renderCard();

      expect(screen.getByTestId("sso-update-notice").textContent).toContain(
        "LangWatch set this single sign-on up for your organization. Connect your own identity provider to run it yourself.",
      );
      const action = screen.getByRole("link", {
        name: /Update single sign-on/,
      });
      expect(action.getAttribute("href")).toBe(
        "/settings/authentication/provider",
      );
    });

    /** @scenario "A reader who may not manage single sign-on is told who can update it" */
    it("shows the same notice without an action to a reader who may not act", () => {
      renderCard({ canManage: false });

      expect(screen.getByTestId("sso-update-notice")).toBeDefined();
      expect(
        screen.queryByRole("link", { name: /Update single sign-on/ }),
      ).toBeNull();
    });

    /** @scenario "An organization is offered its own identity provider on the Authentication overview" */
    it("never calls any of it a migration", () => {
      const { container } = renderCard();

      expect(container.textContent?.toLowerCase()).not.toContain("migrat");
    });
  });
});

describe("given an organization that registered its own identity provider", () => {
  describe("when an administrator opens Authentication", () => {
    /** @scenario "Once it is under way, the overview says where the update got to" */
    it("wears the same status word the single sign-on page uses, and links to it", () => {
      renderCard({
        setup: setupWith({
          migration: {
            phase: "GRACE_DIRECT",
          } as NonNullable<SelfServeSetupView["migration"]>,
        }),
      });

      expect(screen.getByTestId("sso-update-chip").textContent).toContain(
        "Switched over",
      );
      expect(
        screen.getByRole("link", { name: "Where it stands" }).getAttribute(
          "href",
        ),
      ).toBe("/settings/authentication/provider");
      // The invitation is gone: this organization has already taken it.
      expect(screen.queryByTestId("sso-update-notice")).toBeNull();
    });
  });
});

describe("given an organization that registered its identity provider itself", () => {
  describe("when an administrator opens Authentication", () => {
    /** @scenario "An organization is offered its own identity provider on the Authentication overview" */
    it("is offered nothing to update", () => {
      renderCard({ setup: setupWith({ source: "self-serve" }) });

      expect(screen.queryByTestId("sso-update-notice")).toBeNull();
      expect(screen.queryByTestId("sso-update-chip")).toBeNull();
    });
  });
});
