/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Zag's select machine calls scrollTo on the options container after a
// selection; jsdom doesn't implement it, and the thrown TypeError aborts
// the action chain — onValueChange never runs. Stub it once for the file.
beforeAll(() => {
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => {};
  }
});

import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../../hooks/useModelProviderForm";
import type { MaybeStoredModelProvider } from "../../../server/modelProviders/registry";
import { ProviderScopeSection } from "../ModelProviderScopeSection";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function buildState(
  overrides: Partial<UseModelProviderFormState> = {},
): UseModelProviderFormState {
  return {
    useApiGateway: false,
    customKeys: {},
    displayKeys: {},
    initialKeys: {},
    extraHeaders: [],
    customModels: [],
    customEmbeddingsModels: [],
    useAsDefaultProvider: false,
    projectDefaultModel: null,
    projectTopicClusteringModel: null,
    projectEmbeddingsModel: null,
    scopeType: "PROJECT",
    isSaving: false,
    errors: {},
    ...overrides,
  };
}

function buildActions(
  overrides: Partial<UseModelProviderFormActions> = {},
): UseModelProviderFormActions {
  return {
    setEnabled: vi.fn(),
    setScopeType: vi.fn(),
    setUseApiGateway: vi.fn(),
    setCustomKey: vi.fn(),
    addExtraHeader: vi.fn(),
    removeExtraHeader: vi.fn(),
    toggleExtraHeaderConcealed: vi.fn(),
    setExtraHeaderKey: vi.fn(),
    setExtraHeaderValue: vi.fn(),
    addCustomModel: vi.fn(),
    removeCustomModel: vi.fn(),
    setCustomModels: vi.fn(),
    addCustomEmbeddingsModel: vi.fn(),
    removeCustomEmbeddingsModel: vi.fn(),
    setUseAsDefaultProvider: vi.fn(),
    setProjectDefaultModel: vi.fn(),
    setProjectTopicClusteringModel: vi.fn(),
    setProjectEmbeddingsModel: vi.fn(),
    setManaged: vi.fn(),
    submit: vi.fn(),
    ...overrides,
  };
}

const newProvider: MaybeStoredModelProvider = {
  provider: "openai",
  enabled: false,
  customKeys: null,
  models: null,
  embeddingsModels: null,
  disabledByDefault: true,
  deploymentMapping: null,
  extraHeaders: [],
};

const existingProvider: MaybeStoredModelProvider = {
  ...newProvider,
  id: "mp_existing_123",
  enabled: true,
};

describe("ProviderScopeSection", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when the provider already exists", () => {
    it("renders a read-only scope badge in an org/team context (finding #81)", () => {
      render(
        <Wrapper>
          <ProviderScopeSection
            state={buildState()}
            actions={buildActions()}
            provider={{ ...existingProvider, scopeType: "ORGANIZATION" } as any}
            teamId="team_1"
            organizationId="org_1"
          />
        </Wrapper>,
      );

      expect(screen.getByText(/^Scope$/i)).toBeInTheDocument();
      expect(screen.getByText(/^Organization$/i)).toBeInTheDocument();
      // No combobox on read-only view
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(
        screen.getByText(/Scope is fixed after create/i),
      ).toBeInTheDocument();
    });

    it("shows 'Project' badge for a project-scoped row when org/team exists", () => {
      render(
        <Wrapper>
          <ProviderScopeSection
            state={buildState()}
            actions={buildActions()}
            provider={existingProvider}
            teamId="team_1"
            organizationId="org_1"
          />
        </Wrapper>,
      );

      expect(screen.getByText(/^Project$/i)).toBeInTheDocument();
    });

    it("does not render for a project-scoped row on a personal-account project (no org/team)", () => {
      render(
        <Wrapper>
          <ProviderScopeSection
            state={buildState()}
            actions={buildActions()}
            provider={existingProvider}
            teamId={undefined}
            organizationId={undefined}
          />
        </Wrapper>,
      );

      expect(screen.queryByText(/^Scope$/i)).not.toBeInTheDocument();
    });
  });

  describe("when the provider is new and the user has an org + team", () => {
    it("renders a scope select (not radios) labeled 'Scope'", () => {
      render(
        <Wrapper>
          <ProviderScopeSection
            state={buildState()}
            actions={buildActions()}
            provider={newProvider}
            teamId="team_1"
            teamName="platform"
            organizationId="org_1"
            organizationName="acme"
            projectId="proj_1"
            projectName="web-app"
          />
        </Wrapper>,
      );

      expect(screen.getByText(/^Scope$/i)).toBeInTheDocument();
      expect(screen.queryByRole("radio")).not.toBeInTheDocument();
      // Trigger surfaces as a role=combobox (Chakra Select.Trigger).
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    it("calls setScopeType when the user picks Team from the select", async () => {
      const setScopeType = vi.fn();
      const user = userEvent.setup();

      render(
        <Wrapper>
          <ProviderScopeSection
            state={buildState()}
            actions={buildActions({ setScopeType })}
            provider={newProvider}
            teamId="team_1"
            teamName="platform"
            organizationId="org_1"
            organizationName="acme"
            projectId="proj_1"
            projectName="web-app"
          />
        </Wrapper>,
      );

      await user.click(screen.getByRole("combobox"));
      // Team option renders by team name.
      await user.click(await screen.findByRole("option", { name: /platform/i }));

      expect(setScopeType).toHaveBeenCalledWith("TEAM");
    });

    it("shows a scope-specific description for the active scope", () => {
      render(
        <Wrapper>
          <ProviderScopeSection
            state={buildState({ scopeType: "ORGANIZATION" })}
            actions={buildActions()}
            provider={newProvider}
            teamId="team_1"
            teamName="platform"
            organizationId="org_1"
            organizationName="acme"
          />
        </Wrapper>,
      );

      expect(
        screen.getByText(/Every project in the organization inherits/i),
      ).toBeInTheDocument();
    });
  });

  describe("when the user has no team or org (personal project)", () => {
    it("does not render the picker at all", () => {
      render(
        <Wrapper>
          <ProviderScopeSection
            state={buildState()}
            actions={buildActions()}
            provider={newProvider}
            teamId={undefined}
            organizationId={undefined}
          />
        </Wrapper>,
      );

      expect(screen.queryByText(/^Scope$/i)).not.toBeInTheDocument();
    });
  });

  describe("when only an org is present (no team)", () => {
    it("exposes Project and Organization entries but not Team", async () => {
      const user = userEvent.setup();

      render(
        <Wrapper>
          <ProviderScopeSection
            state={buildState()}
            actions={buildActions()}
            provider={newProvider}
            teamId={undefined}
            organizationId="org_1"
            organizationName="acme"
            projectId="proj_1"
            projectName="web-app"
          />
        </Wrapper>,
      );

      await user.click(screen.getByRole("combobox"));
      const options = await screen.findAllByRole("option");
      const labels = options.map((el) => el.textContent ?? "");
      expect(labels.some((l) => /acme/i.test(l))).toBe(true);
      expect(labels.some((l) => /web-app/i.test(l))).toBe(true);
      expect(labels.some((l) => /^Team$/i.test(l))).toBe(false);
    });
  });
});
