/**
 * @vitest-environment jsdom
 *
 * What a virtual-key row says about how to reach a provider.
 *
 * A provider type prefix names a KIND of provider, so with two OpenAI
 * providers on one key "openai/gpt-5-mini" matches both and the key's own
 * order decides. That order is a property of the KEY, so this is the only
 * place it can honestly be shown.
 *
 * Renders the real component tree (real ProviderRow, real Chakra) with no
 * mocks.
 *
 * Spec: specs/ai-gateway/instance-routing-handle.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { OrgModelProvider } from "../eligibleModelProviders";
import {
  ALL_PROVIDERS,
  VirtualKeyProviderAccessSection,
} from "../VirtualKeyProviderAccessSection";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const ORG_ID = "org-acme";
const TEAM_ID = "team-platform";
const PROJECT_ID = "project-doc-chat";

const first: OrgModelProvider = {
  id: "mp-first",
  name: "Anthropic United States",
  provider: "anthropic",
  enabled: true,
  scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
  models: ["claude-sonnet-5"],
};

const second: OrgModelProvider = {
  id: "mp-second",
  name: "Anthropic Europe",
  provider: "anthropic",
  enabled: true,
  scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
  models: ["claude-sonnet-5"],
  routingHandle: "europe",
};

function renderSection({ providers }: { providers: OrgModelProvider[] }) {
  render(
    <Wrapper>
      <VirtualKeyProviderAccessSection
        value={ALL_PROVIDERS}
        onChange={() => undefined}
        scopes={[{ scopeType: "PROJECT", scopeId: PROJECT_ID }]}
        organizationId={ORG_ID}
        organizationName="Acme"
        availableTeams={[{ id: TEAM_ID, name: "platform" }]}
        availableProjects={[
          { id: PROJECT_ID, name: "Doc Chat · platform", teamId: TEAM_ID },
        ]}
        providers={providers}
      />
    </Wrapper>,
  );
}

describe("VirtualKeyProviderRow routing", () => {
  afterEach(() => cleanup());

  describe("given two providers of the same type on one key", () => {
    describe("when one of them carries a routing handle", () => {
      it("shows the handle as a way to reach that provider", () => {
        renderSection({ providers: [first, second] });

        expect(
          screen.getByTestId("vk-provider-mp-second-handle-spelling"),
        ).toHaveTextContent("europe/<model>");
        expect(
          screen.queryByTestId("vk-provider-mp-first-handle-spelling"),
        ).toBeNull();
      });

      it("shows the provider type on every row of that type", () => {
        renderSection({ providers: [first, second] });

        for (const id of ["mp-first", "mp-second"]) {
          expect(
            screen.getByTestId(`vk-provider-${id}-type-spelling`),
          ).toHaveTextContent("anthropic/<model>");
        }
      });

      it("marks only the first provider of the type as the one a bare type reaches", () => {
        renderSection({ providers: [first, second] });

        expect(
          screen.getByTestId("vk-provider-mp-first-first-for-type"),
        ).toHaveTextContent("first for anthropic");
        expect(
          screen.queryByTestId("vk-provider-mp-second-first-for-type"),
        ).toBeNull();
      });
    });
  });

  describe("given a provider with no routing handle", () => {
    it("shows only the provider type", () => {
      renderSection({ providers: [first] });

      expect(
        screen.getByTestId("vk-provider-mp-first-type-spelling"),
      ).toHaveTextContent("anthropic/<model>");
      expect(
        screen.queryByTestId("vk-provider-mp-first-handle-spelling"),
      ).toBeNull();
    });
  });
});
