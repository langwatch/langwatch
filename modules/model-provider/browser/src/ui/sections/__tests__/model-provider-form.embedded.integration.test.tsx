/**
 * @vitest-environment jsdom
 * @see specs/langy/langy-inline-model-setup.feature
 */
import { getProviderModelOptions } from "@langwatch/model-provider-contract";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validateApiKey = vi.fn();
const updateProvider = vi.fn();
const assignRole = vi.fn();
const listing = { rows: [] as unknown[] };
const codex = {
  phase: { name: "idle" } as Record<string, unknown>,
  begin: vi.fn(),
  cancel: vi.fn(),
};

vi.mock("../../../behavior/use-codex-device-sign-in.ts", () => ({
  useCodexDeviceSignIn: () => ({
    phase: codex.phase,
    connected: null,
    storedProviderId: null,
    disconnecting: false,
    begin: codex.begin,
    cancel: codex.cancel,
    disconnect: vi.fn(),
  }),
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn(), openDrawer: vi.fn() }),
}));

vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("@langwatch/model-provider-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useModelProvidersSettings: () => ({
    providers: {},
    modelMetadata: {},
    isLoading: false,
    refetch: vi.fn(),
    hasEnabledProviders: false,
  }),
}));

vi.mock("../../../behavior/model-provider-api.ts", () => {
  const query = (data: unknown) => ({
    useQuery: () => ({ data, isLoading: false, isSuccess: true, refetch: vi.fn() }),
  });
  const mutation = (mutateAsync: (...args: unknown[]) => unknown) => ({
    useMutation: () => ({ mutateAsync, mutate: vi.fn(), isPending: false }),
  });
  const modelProvider = {
    isManagedProvider: query({ managed: false }),
    listAllForOrganizationForFrontend: {
      useQuery: () => ({ data: listing.rows, isLoading: false, isSuccess: true, refetch: vi.fn() }),
    },
    listAllForProjectForFrontend: {
      useQuery: () => ({ data: listing.rows, isLoading: false, isSuccess: true, refetch: vi.fn() }),
    },
    codexStatus: query(undefined),
    codexSignInStart: mutation(vi.fn()),
    codexSignInPoll: mutation(vi.fn()),
    delete: mutation(vi.fn()),
    update: mutation((...args) => updateProvider(...args)),
    validateApiKey: mutation((...args) => validateApiKey(...args)),
    setRoleAssignmentForScope: mutation((...args) => assignRole(...args)),
  };
  const invalidate = () => Promise.resolve();
  const queries = new Proxy({}, { get: () => ({ invalidate }) });
  const useUtils = () => ({ modelProvider: queries });
  return {
    modelProviderApi: { useUtils, modelProvider },
    api: { useUtils, modelProvider },
  };
});

import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing.tsx";
import { EditModelProviderForm } from "../model-provider-form.tsx";

function renderEmbedded(providerKey: string, onSaved = vi.fn()) {
  renderWithModelProviderHost(
    <EditModelProviderForm
      projectId="proj-1"
      organizationId="org-1"
      modelProviderId="new"
      providerKey={providerKey}
      embedded
      onSaved={onSaved}
    />,
    new FakeModelProviderHost({ grants: new Set(["organization:manage"]) }),
  );
  return { onSaved };
}

describe("the shared provider form embedded in Langy's model setup", () => {
  beforeEach(() => {
    validateApiKey.mockReset().mockResolvedValue({ valid: true });
    updateProvider.mockReset().mockResolvedValue({});
    assignRole.mockReset().mockResolvedValue({});
    codex.phase = { name: "idle" };
    listing.rows = [];
  });

  afterEach(() => cleanup());

  describe("when an API key provider is shown", () => {
    /** @scenario "The inline setup asks only for credentials and a default chat model" */
    it("asks for the credentials and a default chat model, and no name, scope or advanced settings", () => {
      renderEmbedded("openai");

      expect(screen.getByText("Configure OpenAI")).toBeInTheDocument();
      expect(screen.getByText("Enter your API credentials for OpenAI")).toBeInTheDocument();
      expect(screen.getByLabelText("OPENAI_API_KEY")).toBeInTheDocument();
      expect(screen.getByLabelText("Default Chat Model")).toBeInTheDocument();
      expect(screen.queryByTestId("model-provider-name")).toBeNull();
      expect(screen.queryByText(/scope/i)).toBeNull();
      expect(screen.queryByText(/advanced/i)).toBeNull();
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });

    /** @scenario "The inline setup asks only for credentials and a default chat model" */
    it("saves at the organization and makes the picked model the default", async () => {
      const { onSaved } = renderEmbedded("openai");
      const [model] = getProviderModelOptions("openai", "chat");
      if (!model) throw new Error("OpenAI has no chat models in the registry");
      const user = userEvent.setup();

      await user.type(screen.getByLabelText("OPENAI_API_KEY"), "sk-typed");
      await user.selectOptions(
        screen.getByLabelText("Default Chat Model"),
        `openai/${model.value}`,
      );
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(updateProvider).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "openai", scopeType: "ORGANIZATION" }),
      );
      expect(assignRole).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeType: "ORGANIZATION",
          role: "DEFAULT",
          model: `openai/${model.value}`,
        }),
      );
    });
  });

  describe("when Codex is shown", () => {
    /** @scenario "The inline setup offers provider marks with Codex first and recommended" */
    it("offers the Codex sign-in under a Connect heading", () => {
      renderEmbedded("openai_codex");

      expect(screen.getByText("Connect Codex (OpenAI account)")).toBeInTheDocument();
      expect(screen.queryByLabelText("Default Chat Model")).toBeNull();
      expect(screen.queryByText(/scope/i)).toBeNull();
    });
  });
});
