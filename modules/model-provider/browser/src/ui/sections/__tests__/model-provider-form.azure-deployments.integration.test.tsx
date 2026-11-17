/**
 * @vitest-environment jsdom
 * Azure OpenAI lists only the deployments added to it, so a form with none warns before saving.
 * @see modules/model-provider/specs/default-models-scope-model-options.feature
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let storedRows: unknown[] = [];

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
  const query = (read: () => unknown) => ({
    useQuery: () => ({ data: read(), isLoading: false, isSuccess: true, refetch: vi.fn() }),
  });
  const mutation = { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) };
  const modelProvider = {
    isManagedProvider: query(() => ({ managed: false })),
    listAllForOrganizationForFrontend: query(() => storedRows),
    listAllForProjectForFrontend: query(() => storedRows),
    update: mutation,
    validateApiKey: mutation,
    setRoleAssignmentForScope: mutation,
  };
  const useUtils = () => ({ modelProvider: { invalidate: vi.fn() } });
  return { modelProviderApi: { useUtils, modelProvider }, api: { useUtils, modelProvider } };
});

import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing.tsx";
import { EditModelProviderForm } from "../model-provider-form.tsx";

type Deployment = { modelId: string; displayName: string; mode: "chat" | "embedding" };

function azureRow(customModels: Deployment[], customEmbeddingsModels: Deployment[] = []) {
  return {
    id: "mp_azure",
    provider: "azure",
    name: "Azure OpenAI",
    enabled: true,
    disabledAt: null,
    healthStatus: null,
    customKeys: { AZURE_OPENAI_API_KEY: "**redacted**", AZURE_OPENAI_ENDPOINT: "https://acme" },
    deploymentMapping: null,
    scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
    models: null,
    embeddingsModels: null,
    customModels,
    customEmbeddingsModels,
    langySkipPermissionsModels: null,
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
  };
}

function renderAzureForm() {
  return renderWithModelProviderHost(
    <EditModelProviderForm
      projectId="proj-1"
      organizationId="org-1"
      providerKey="azure"
      modelProviderId="mp_azure"
    />,
    new FakeModelProviderHost({ grants: new Set() }),
  );
}

describe("<EditModelProviderForm/> for Azure OpenAI", () => {
  afterEach(() => cleanup());

  describe("given the provider lists no chat deployment", () => {
    /** @scenario "An Azure provider with no chat deployment warns before saving" */
    it("warns that nothing can be picked until a chat deployment is added, and keeps Save on", async () => {
      storedRows = [azureRow([])];
      renderAzureForm();

      const warning = await screen.findByTestId("no-chat-deployment-warning");
      expect(warning).toHaveTextContent("Azure OpenAI lists only the deployments you add");
      expect(screen.getByTestId("model-provider-save")).toBeEnabled();
    });
  });

  describe("given the provider lists an embedding deployment but no chat deployment", () => {
    /** @scenario "An Azure provider with only embedding deployments warns that chat is missing" */
    it("says only a chat deployment is missing, not that nothing can be picked", async () => {
      const embedding = { modelId: "embed", displayName: "embed", mode: "embedding" as const };
      storedRows = [azureRow([], [embedding])];
      renderAzureForm();

      const warning = await screen.findByTestId("no-chat-deployment-warning");
      expect(warning).toHaveTextContent("has embedding deployments but no chat deployment yet");
      expect(warning).not.toHaveTextContent("no model from it can be picked");
    });
  });

  describe("given the provider lists a chat deployment", () => {
    /** @scenario "An Azure provider with a chat deployment shows no warning" */
    it("shows no missing deployment warning", async () => {
      storedRows = [azureRow([{ modelId: "prod-gpt", displayName: "prod-gpt", mode: "chat" }])];
      renderAzureForm();

      await screen.findByText("Custom Models");
      expect(screen.queryByTestId("no-chat-deployment-warning")).toBeNull();
    });
  });
});
