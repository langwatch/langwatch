/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  within,
} from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { ProviderScopeSection } from "../ModelProviderScopeSection";
import type {
  ScopeSelection,
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../../hooks/useModelProviderForm";
import type { MaybeStoredModelProvider } from "../../../server/modelProviders/registry";

const baseProvider: MaybeStoredModelProvider = {
  provider: "openai",
  enabled: false,
  customKeys: null,
  models: null,
  embeddingsModels: null,
  disabledByDefault: true,
  deploymentMapping: null,
  extraHeaders: [],
};

const baseState = (scopes: ScopeSelection[] = []): UseModelProviderFormState =>
  ({
    name: "",
    scopes,
    useApiGateway: false,
  }) as unknown as UseModelProviderFormState;

function renderSection({
  scopes = [],
  setScopes = vi.fn(),
  projectId = "proj-web-app",
  teamId = "team-platform",
  organizationId = "org-acme",
}: {
  scopes?: ScopeSelection[];
  setScopes?: (s: ScopeSelection[]) => void;
  projectId?: string;
  teamId?: string;
  organizationId?: string;
} = {}) {
  const actions = { setScopes } as unknown as UseModelProviderFormActions;
  render(
    <ChakraProvider value={defaultSystem}>
      <ProviderScopeSection
        state={baseState(scopes)}
        actions={actions}
        provider={baseProvider}
        teamId={teamId}
        teamName="platform"
        organizationId={organizationId}
        organizationName="acme"
        projectId={projectId}
        projectName="web-app"
      />
    </ChakraProvider>,
  );
  return { setScopes };
}

describe("Model provider scope — dropdown-only picker", () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it("renders the scope dropdown without quick-pick chips", () => {
    // The drawer used to render Organization/Team/Project/Multiple
    // quick-pick chips above the dropdown. They were redundant in
    // practice — the dropdown already surfaces every reachable scope —
    // and the quick-pick row was dropped so the picker reads consistent
    // with the default-models override drawer.
    renderSection();
    expect(
      screen.queryByRole("group", { name: /quick scope/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("hides the section a user cannot pick into (no team / no org context)", () => {
    // Personal-account project: no org, no team — section is invisible.
    render(
      <ChakraProvider value={defaultSystem}>
        <ProviderScopeSection
          state={baseState()}
          actions={{ setScopes: vi.fn() } as unknown as UseModelProviderFormActions}
          provider={baseProvider}
          teamId={undefined}
          organizationId={undefined}
          projectId="proj-web-app"
        />
      </ChakraProvider>,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
