/**
 * @vitest-environment jsdom
 *
 * Integration tests for EditModelProviderForm's oauth-device (codex)
 * rendering + save rules (spec:
 * specs/model-providers/codex-account-provider.feature):
 * - the CREDENTIALS section is the CodexSignIn flow, not API-key fields;
 * - the custom-models section is hidden (codex models come from the
 *   registry catalog);
 * - Save (name / scope edits) skips the API-key schema validation that
 *   gates every api-key provider, since the sign-in itself persisted the
 *   credentials;
 * - a completed sign-in closes the drawer (the poll persisted the row, so
 *   Save has nothing left to do) and queues the coding-defaults ask to the
 *   page-level host instead of mounting a dialog inside the drawer.
 *
 * Uses the shared model-provider drawer harness; the api mock also feeds
 * CodexSignIn's status/sign-in endpoints so the real component renders.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../../hooks/useModelProviderForm";
import type { MaybeStoredModelProvider } from "../../../server/modelProviders/registry";
import {
  modelProviderDrawerMocks,
  resetModelProviderDrawerMocks,
  Wrapper,
} from "./modelProviderDrawerHarness";
import { useCodexCodingDefaultsAskStore } from "../CodexCodingDefaultsAsk";
import { EditModelProviderForm } from "../ModelProviderForm";

const {
  mockListAllForOrganizationForFrontendQuery: mockListAllForOrgQuery,
  mockListAllForProjectForFrontendQuery: mockListAllForProjectQuery,
  mockCloseDrawer,
  mockCodexSignInStart,
  mockCodexSignInPoll,
  mockUseModelProviderForm,
  mockUseModelProvidersSettings,
  mockUseOrganizationTeamProject,
} = modelProviderDrawerMocks;

function buildState(
  overrides: Partial<UseModelProviderFormState> = {},
): UseModelProviderFormState {
  return {
    isDirty: false,
    routingHandle: "",
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
    name: "Codex (OpenAI account)",
    scopes: [],
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
    setName: vi.fn(),
    setRoutingHandle: vi.fn(),
    setScopes: vi.fn(),
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

function buildProvider(
  overrides: Partial<MaybeStoredModelProvider> & { provider: string },
): MaybeStoredModelProvider {
  return {
    enabled: false,
    customKeys: null,
    models: null,
    embeddingsModels: null,
    disabledByDefault: true,
    deploymentMapping: null,
    extraHeaders: [],
    ...overrides,
  };
}

function primeHooksForProvider({
  providerKey,
  displayKeys,
  state = {},
  actions = {},
}: {
  providerKey: string;
  displayKeys: Record<string, z.ZodTypeAny>;
  state?: Partial<UseModelProviderFormState>;
  actions?: Partial<UseModelProviderFormActions>;
}) {
  mockUseOrganizationTeamProject.mockReturnValue({
    project: {
      id: "proj-1",
      name: "Web App",
      slug: "test-project",
      defaultModel: null,
    },
    team: { id: "team-1", name: "Platform" },
    organization: {
      id: "org-1",
      name: "Acme",
      teams: [
        {
          id: "team-1",
          name: "Platform",
          projects: [{ id: "proj-1", name: "Web App" }],
        },
      ],
    },
    hasPermission: () => false,
  });
  const provider = buildProvider({ provider: providerKey });
  mockUseModelProvidersSettings.mockReturnValue({
    providers: { [providerKey]: provider },
    modelMetadata: {},
    isLoading: false,
    refetch: vi.fn(),
    hasEnabledProviders: false,
  });
  mockListAllForOrgQuery.mockReturnValue({
    data: { providers: [provider], modelMetadata: {} },
    isLoading: false,
    refetch: vi.fn(),
  });
  mockListAllForProjectQuery.mockReturnValue({
    data: { providers: [provider], modelMetadata: {} },
    isLoading: false,
    refetch: vi.fn(),
  });
  const builtActions = buildActions(actions);
  mockUseModelProviderForm.mockReturnValue([
    buildState({ displayKeys, ...state }),
    builtActions,
  ]);
  return { actions: builtActions };
}

function renderForm(providerKey: string) {
  return render(
    <Wrapper>
      <EditModelProviderForm
        projectId="proj-1"
        organizationId="org-1"
        providerKey={providerKey}
      />
    </Wrapper>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Feature: Codex model provider form rendering", () => {
  beforeEach(() => {
    resetModelProviderDrawerMocks();
    useCodexCodingDefaultsAskStore.setState({ pending: null });
  });

  afterEach(() => {
    cleanup();
  });

  describe("given providerKey is openai_codex (authFlow oauth-device)", () => {
    describe("when the form renders", () => {
      beforeEach(() => {
        primeHooksForProvider({
          providerKey: "openai_codex",
          displayKeys: { CODEX_ACCESS_TOKEN: z.string() },
        });
        renderForm("openai_codex");
      });

      it("renders the sign-in-with-OpenAI flow in place of credential fields", () => {
        expect(
          screen.getByRole("button", { name: /sign in with openai/i }),
        ).toBeTruthy();
      });

      it("does not render the API-key credential inputs", () => {
        expect(screen.queryByText("CODEX_ACCESS_TOKEN")).toBeNull();
      });

      it("does not render the Custom Models section", () => {
        expect(screen.queryByText("Custom Models")).toBeNull();
      });

      it("renders the Name field", () => {
        expect(screen.getByText("Name")).toBeTruthy();
      });

      it("renders the Save button for name and scope edits", () => {
        expect(screen.getByRole("button", { name: /save/i })).toBeTruthy();
      });
    });

    describe("when the user saves a name or scope edit", () => {
      it("submits without running the API-key schema validation", () => {
        const { actions } = primeHooksForProvider({
          providerKey: "openai_codex",
          displayKeys: { CODEX_ACCESS_TOKEN: z.string() },
          state: { isDirty: true },
        });
        renderForm("openai_codex");

        fireEvent.click(screen.getByRole("button", { name: /save/i }));

        expect(actions.submit).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the sign-in completes inside the drawer", () => {
      const codexScopes = [
        { scopeType: "PROJECT" as const, scopeId: "proj-1" },
      ];

      beforeEach(async () => {
        // A full device sign-in, driven for real through the hook: start
        // hands back a device code, the zero-interval poll completes on its
        // first tick and persists the provider row server-side.
        mockCodexSignInStart.mockResolvedValue({
          userCode: "MHBV-RVX1N",
          deviceAuthId: "device-auth-1",
          verificationUrl: "https://auth.openai.com/device",
          intervalSeconds: 0,
        });
        mockCodexSignInPoll.mockResolvedValue({
          status: "complete",
          providerId: "mp-codex-1",
          email: "dev@acme.dev",
          plan: "plus",
        });
        primeHooksForProvider({
          providerKey: "openai_codex",
          displayKeys: { CODEX_ACCESS_TOKEN: z.string() },
          state: { scopes: codexScopes },
        });
        renderForm("openai_codex");

        fireEvent.click(
          screen.getByRole("button", { name: /sign in with openai/i }),
        );
        await waitFor(() => expect(mockCodexSignInPoll).toHaveBeenCalled());
      });

      /** @scenario Connecting Codex from settings finishes the drawer's job */
      it("closes the drawer on its own, since the row is already saved", async () => {
        await waitFor(() => expect(mockCloseDrawer).toHaveBeenCalledTimes(1));
      });

      /** @scenario Connecting Codex from settings finishes the drawer's job */
      it("mounts no coding-defaults dialog inside the drawer", async () => {
        await waitFor(() => expect(mockCloseDrawer).toHaveBeenCalled());
        expect(
          screen.queryByText("Set Codex as your coding default?"),
        ).toBeNull();
      });

      /** @scenario Connecting Codex from settings asks before touching defaults */
      it("queues the coding-defaults ask for the page-level host", async () => {
        await waitFor(() =>
          expect(useCodexCodingDefaultsAskStore.getState().pending).toEqual({
            projectId: "proj-1",
            scopes: codexScopes,
          }),
        );
      });
    });
  });

  describe("given providerKey is openai (api-key control)", () => {
    describe("when the user saves with empty credentials", () => {
      it("blocks the submit on the API-key schema validation", () => {
        const { actions } = primeHooksForProvider({
          providerKey: "openai",
          displayKeys: {
            OPENAI_API_KEY: z.string().nullable().optional(),
            OPENAI_BASE_URL: z.string().nullable().optional(),
          },
          state: { isDirty: true, name: "OpenAI" },
        });
        renderForm("openai");

        fireEvent.click(screen.getByRole("button", { name: /save/i }));

        expect(actions.submit).not.toHaveBeenCalled();
      });
    });
  });
});
