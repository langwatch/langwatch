/**
 * @vitest-environment jsdom
 *
 * The provider tiles show each identity provider's full name. The grid was
 * four columns wide at a fixed count and each name was clamped to one line,
 * so on a settings page beside the assistant panel every name past four
 * letters rendered as "Micr...", "Goo...", "Som...".
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/errors/logic/presentation", () => ({
  explainAnyError: () => ({ title: "t", describe: () => "d" }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/api", () => ({
  api: {
    ssoSetup: {
      register: { useMutation: () => ({ mutate: vi.fn() }) },
      startLegacyMigration: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    ssoConnections: {
      startLegacyMigration: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    useUtils: () => ({
      ssoSetup: { getSetup: { invalidate: vi.fn() } },
      ssoConnections: { invalidate: vi.fn() },
    }),
  },
}));

import { IDENTITY_PROVIDER_PRESETS } from "../identityProviders";
import { RegisterConnection } from "../RegisterConnection";

const SERVICE_PROVIDER = {
  redirectUrl: "https://app.test/api/auth/sso/callback/{connection}",
  assertionConsumerServiceUrl:
    "https://app.test/api/auth/sso/saml2/sp/acs/{connection}",
  singleLogoutUrl: "https://app.test/api/auth/sso/saml2/sp/slo/{connection}",
  entityId: "https://app.test/api/auth/sso/saml2/sp",
  metadataUrl:
    "https://app.test/api/auth/sso/saml2/sp/metadata?providerId={connection}",
};

function renderPicker() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <RegisterConnection
        organizationId="org_acme"
        serviceProvider={SERVICE_PROVIDER}
      />
    </ChakraProvider>,
  );
}

describe("given the identity provider picker", () => {
  afterEach(cleanup);

  describe("when it renders", () => {
    it("shows every provider's full name without clipping it", () => {
      renderPicker();

      for (const preset of IDENTITY_PROVIDER_PRESETS) {
        const tile = screen.getByTestId(`identity-provider-${preset.id}`);
        const name = Array.from(tile.querySelectorAll("p")).find(
          (element) => element.textContent === preset.name,
        );
        expect(name, preset.name).toBeDefined();
        const style = window.getComputedStyle(name as Element);
        expect(style.overflow).not.toBe("hidden");
        expect(style.getPropertyValue("-webkit-line-clamp")).toBe("");
      }
    });

    it("lets the grid drop columns rather than squeeze the tiles", () => {
      renderPicker();

      for (const label of ["Who signs your team in?", "Connect by protocol"]) {
        const grid = screen.getByRole("radiogroup", { name: label });
        expect(window.getComputedStyle(grid).gridTemplateColumns).toContain(
          "minmax(12rem, 1fr)",
        );
      }
    });
  });

  describe("when a provider is picked", () => {
    it("explains the two ways to connect in plain sentences", () => {
      renderPicker();
      fireEvent.click(screen.getByTestId("identity-provider-keycloak"));

      expect(
        screen.getByText(
          "There are two ways to connect. Pick the one your identity provider's app gave you. Either one works.",
        ),
      ).toBeDefined();
    });
  });
});
