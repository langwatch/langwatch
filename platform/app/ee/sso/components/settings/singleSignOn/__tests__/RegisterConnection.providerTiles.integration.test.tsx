/**
 * @vitest-environment jsdom
 *
 * The provider tiles show each identity provider's full name.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
    it("names every provider in full on its tile", () => {
      renderPicker();

      for (const preset of IDENTITY_PROVIDER_PRESETS) {
        const tile = screen.getByTestId(`identity-provider-${preset.id}`);
        expect(
          within(tile).getByText(preset.name, { exact: true }),
          preset.name,
        ).toBeDefined();
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
