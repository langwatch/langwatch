/**
 * @vitest-environment jsdom
 *
 * The "Provider access" section of the virtual-key drawers. The "All
 * providers" master checkbox: checking it stores the wildcard (every provider
 * in scope, current and future); unchecking it clears the selection, so no row
 * stays checked and the section asks the operator to pick at least one
 * provider.
 *
 * Renders the real component tree (real ProviderRow, real Chakra) with no
 * mocks.
 *
 * Spec: specs/ai-gateway/governance/vk-provider-access.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrgModelProvider } from "../model/eligible-model-providers";
import {
  ALL_PROVIDERS,
  type ProviderAccessValue,
  VirtualKeyProviderAccessSection,
} from "../ui/blocks/virtual-key-provider-access-section";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const ORG_ID = "org-acme";
const TEAM_ID = "team-platform";
const PROJECT_ID = "project-doc-chat";

const availableTeams = [{ id: TEAM_ID, name: "platform" }];
const availableProjects = [
  { id: PROJECT_ID, name: "Doc Chat · platform", teamId: TEAM_ID },
];
const projectScope = [{ scopeType: "PROJECT" as const, scopeId: PROJECT_ID }];

const ORG_PROVIDER_ID = "mp-org-alpha";
const PROJECT_PROVIDER_ID = "mp-proj-beta";

const orgProvider: OrgModelProvider = {
  id: ORG_PROVIDER_ID,
  name: "Alpha Org",
  provider: "openai",
  enabled: true,
  scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
  models: ["gpt-5-mini"],
};

const projectProvider: OrgModelProvider = {
  id: PROJECT_PROVIDER_ID,
  name: "Beta Project",
  provider: "openai",
  enabled: true,
  scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
  models: ["gpt-5-mini"],
};

/**
 * Controlled harness: holds the value the way a drawer does, and forwards each
 * change to a spy so a test can assert both the payload and the re-rendered
 * state after an interaction.
 */
function Harness({
  initial,
  onChange,
  providers = [orgProvider, projectProvider],
}: {
  initial: ProviderAccessValue;
  onChange?: (next: ProviderAccessValue) => void;
  providers?: OrgModelProvider[];
}) {
  const [value, setValue] = useState<ProviderAccessValue>(initial);
  return (
    <Wrapper>
      <VirtualKeyProviderAccessSection
        value={value}
        onChange={(next) => {
          onChange?.(next);
          setValue(next);
        }}
        scopes={projectScope}
        organizationId={ORG_ID}
        organizationName="Acme"
        availableTeams={availableTeams}
        availableProjects={availableProjects}
        providers={providers}
      />
    </Wrapper>
  );
}

describe("VirtualKeyProviderAccessSection", () => {
  afterEach(() => cleanup());

  describe("given the master 'All providers' checkbox", () => {
    describe("when the box is unchecked", () => {
      /** @scenario Unchecking All providers clears the selection */
      it("clears the selection and asks for a provider", async () => {
        const onChange = vi.fn();
        render(<Harness initial={ALL_PROVIDERS} onChange={onChange} />);

        await userEvent.click(screen.getByTestId("vk-providers-all"));

        expect(onChange).toHaveBeenLastCalledWith(
          expect.objectContaining({ allProviders: false, providerIds: [] }),
        );
        expect(screen.getByRole("checkbox", { name: "Alpha Org" })).not.toBeChecked();
        expect(screen.getByRole("checkbox", { name: "Beta Project" })).not.toBeChecked();
        expect(screen.getByTestId("vk-providers-invalid")).toHaveTextContent(
          "Select at least one provider, or allow all providers.",
        );
      });
    });

    describe("when the box is checked", () => {
      it("stores the wildcard", async () => {
        const onChange = vi.fn();
        render(
          <Harness
            initial={{
              allProviders: false,
              providerIds: [],
              modelsAllowed: [],
            }}
            onChange={onChange}
          />,
        );

        await userEvent.click(screen.getByTestId("vk-providers-all"));

        expect(onChange).toHaveBeenLastCalledWith(
          expect.objectContaining({ allProviders: true, providerIds: [] }),
        );
      });
    });
  });
});
