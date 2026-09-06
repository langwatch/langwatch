/**
 * @vitest-environment jsdom
 *
 * EditModelProviderForm is parent-gated: LLM-only sections hide when the registry `type` isn't "llm" — e.g. `azure_safety`.
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn(), openDrawer: vi.fn() }),
}));

vi.mock("@langwatch/workflow-web/surfaces/feature-flag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("../../../behavior/use-model-providers-settings.ts", () => ({
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
  const modelProvider = {
    isManagedProvider: query({ managed: false }),
    listAllForOrganizationForFrontend: query([]),
    listAllForProjectForFrontend: query([]),
    update: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    validateApiKey: {
      useMutation: () => ({
        mutateAsync: vi.fn().mockResolvedValue({ valid: true }),
        isPending: false,
      }),
    },
    setRoleAssignmentForScope: {
      useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
    },
  };
  const useUtils = () => ({ modelProvider: { invalidate: vi.fn() } });
  return {
    modelProviderApi: { useUtils, modelProvider },
    api: { useUtils, modelProvider },
  };
});

import { EditModelProviderForm } from "../model-provider-form.tsx";
import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing.tsx";

function renderForm(providerKey: string) {
  return renderWithModelProviderHost(
    <EditModelProviderForm projectId="proj-1" organizationId="org-1" providerKey={providerKey} />,
    new FakeModelProviderHost({ grants: new Set() }),
  );
}

describe("Feature: Azure Safety model provider form rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given providerKey is azure_safety", () => {
    describe("when the form renders", () => {
      beforeEach(() => {
        renderForm("azure_safety");
      });

      it("renders the AZURE_CONTENT_SAFETY_ENDPOINT credential field", async () => {
        expect(await screen.findByText("AZURE_CONTENT_SAFETY_ENDPOINT")).toBeTruthy();
      });

      it("renders the AZURE_CONTENT_SAFETY_KEY credential field", async () => {
        expect(await screen.findByText("AZURE_CONTENT_SAFETY_KEY")).toBeTruthy();
      });

      it("does not render the Custom Models section", async () => {
        await screen.findByText("AZURE_CONTENT_SAFETY_KEY");
        expect(screen.queryByText("Custom Models")).toBeNull();
      });

      it("does not render the Default Provider toggle", async () => {
        await screen.findByText("AZURE_CONTENT_SAFETY_KEY");
        expect(screen.queryByText(/use .* as the default for langwatch/i)).toBeNull();
      });

      it("does not render the Use API Gateway toggle", async () => {
        await screen.findByText("AZURE_CONTENT_SAFETY_KEY");
        expect(screen.queryByText("Use API Gateway")).toBeNull();
      });

      it("renders the Save button", async () => {
        expect(await screen.findByRole("button", { name: /save/i })).toBeTruthy();
      });
    });
  });

  describe("given providerKey is openai (control)", () => {
    describe("when the form renders", () => {
      beforeEach(() => {
        renderForm("openai");
      });

      it("renders the Custom Models section", async () => {
        expect(await screen.findByText("Custom Models")).toBeTruthy();
      });

      /** @scenario Default models live in a section below the providers list, not in the drawer */
      it("no longer renders the Default Provider toggle in the drawer", async () => {
        // Defaults moved to the page-level DefaultModelsSection (see
        // specs/model-providers/hierarchical-default-models.feature).
        await screen.findByText("Custom Models");
        expect(screen.queryByText(/use openai as the default for langwatch/i)).toBeNull();
      });

      it("does not render the Use API Gateway toggle", async () => {
        // API Gateway is Azure-specific, not OpenAI
        await screen.findByText("Custom Models");
        expect(screen.queryByText("Use API Gateway")).toBeNull();
      });
    });
  });
});
