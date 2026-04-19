/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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

      expect(screen.getByText(/Availability/i)).toBeInTheDocument();
      expect(screen.getByText(/^Organization$/i)).toBeInTheDocument();
      // No radios — read-only
      expect(screen.queryAllByRole("radio")).toHaveLength(0);
      // Helper copy for the reparent-means-recreate contract
      expect(
        screen.getByText(/Scope is fixed after create/i),
      ).toBeInTheDocument();
    });

    it("shows 'Project' badge for a project-scoped row when org/team exists", () => {
      // acme-demo (organization present) + legacy PROJECT-scoped row.
      // Rendering the Project badge in-drawer is fine — users need scope
      // context while editing, unlike in the list where 100% of rows being
      // Project-scoped would be visual noise.
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

      expect(screen.queryByText(/Availability/i)).not.toBeInTheDocument();
    });
  });

  describe("when the provider is new and the user has an org + team", () => {
    it("renders all three scope radios", () => {
      render(
        <Wrapper>
          <ProviderScopeSection
            state={buildState()}
            actions={buildActions()}
            provider={newProvider}
            teamId="team_1"
            organizationId="org_1"
          />
        </Wrapper>,
      );

      expect(screen.getByText(/Availability/i)).toBeInTheDocument();
      const radioValues = screen
        .getAllByRole("radio")
        .map((r) => r.getAttribute("value"));
      expect(radioValues).toEqual(
        expect.arrayContaining(["PROJECT", "TEAM", "ORGANIZATION"]),
      );
    });

    it("calls setScopeType when the user picks Team", async () => {
      const setScopeType = vi.fn();
      const user = userEvent.setup();

      render(
        <Wrapper>
          <ProviderScopeSection
            state={buildState()}
            actions={buildActions({ setScopeType })}
            provider={newProvider}
            teamId="team_1"
            organizationId="org_1"
          />
        </Wrapper>,
      );

      // Chakra v3 RadioGroup exposes each item with role=radio, accessible
      // via the visible label text.
      await user.click(screen.getByRole("radio", { name: /Team/i }));

      expect(setScopeType).toHaveBeenCalledWith("TEAM");
    });

    it("shows a scope-specific description for the active radio", () => {
      render(
        <Wrapper>
          <ProviderScopeSection
            state={buildState({ scopeType: "ORGANIZATION" })}
            actions={buildActions()}
            provider={newProvider}
            teamId="team_1"
            organizationId="org_1"
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

      expect(screen.queryByText(/Availability/i)).not.toBeInTheDocument();
    });
  });

  describe("when only an org is present (no team)", () => {
    it("renders Project and Organization but not Team", () => {
      render(
        <Wrapper>
          <ProviderScopeSection
            state={buildState()}
            actions={buildActions()}
            provider={newProvider}
            teamId={undefined}
            organizationId="org_1"
          />
        </Wrapper>,
      );

      const radios = screen.getAllByRole("radio");
      const radioLabels = radios.map((r) => r.getAttribute("value"));
      expect(radioLabels).toContain("PROJECT");
      expect(radioLabels).toContain("ORGANIZATION");
      expect(radioLabels).not.toContain("TEAM");
    });
  });
});
