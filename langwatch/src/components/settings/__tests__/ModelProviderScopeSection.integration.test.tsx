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

const quickGroup = () =>
  within(screen.getByRole("group", { name: /quick scope/i }));

describe("Model provider scope — quick-add chips", () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());


  /** @scenario Quick-add 'This project' chip pre-fills scope to the current project */
  it("clicking 'This project' replaces the scope with only that project", () => {
    const { setScopes } = renderSection();
    fireEvent.click(quickGroup().getByRole("button", { name: /this project/i }));
    expect(setScopes).toHaveBeenCalledWith([
      { scopeType: "PROJECT", scopeId: "proj-web-app" },
    ]);
  });

  /** @scenario Quick-add 'This team' chip pre-fills scope to the parent team */
  it("clicking 'This team' replaces the scope with only that team", () => {
    const { setScopes } = renderSection();
    fireEvent.click(quickGroup().getByRole("button", { name: /this team/i }));
    expect(setScopes).toHaveBeenCalledWith([
      { scopeType: "TEAM", scopeId: "team-platform" },
    ]);
  });

  /** @scenario Quick-add 'Organization' chip pre-fills scope to the organization */
  it("clicking 'Organization' replaces the scope with only the organization", () => {
    const { setScopes } = renderSection();
    fireEvent.click(quickGroup().getByRole("button", { name: /^organization$/i }));
    expect(setScopes).toHaveBeenCalledWith([
      { scopeType: "ORGANIZATION", scopeId: "org-acme" },
    ]);
  });

  it("hides chips a user cannot pick (no team / no org context)", () => {
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
    expect(screen.queryByRole("group", { name: /quick scope/i })).toBeNull();
  });
});
