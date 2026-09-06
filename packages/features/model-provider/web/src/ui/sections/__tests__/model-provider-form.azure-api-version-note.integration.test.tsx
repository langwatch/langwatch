/**
 * @vitest-environment jsdom
 *
 * #7892: the AI Gateway dispatch path pins Azure's api-version itself, so a
 * caller-supplied AZURE_OPENAI_API_VERSION / AZURE_API_GATEWAY_VERSION is
 * dropped there while the direct dispatch path still honors it. The drawer
 * offered both fields with no indication of that split. This pins the helper
 * text the drawer renders for each field, in customer-facing language that
 * never names an internal component.
 *
 * Covers @integration scenarios from
 * specs/ai-gateway/azure-api-version-override.feature.
 */
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn(), openDrawer: vi.fn() }),
}));

vi.mock("@langwatch/workflow-web/surfaces/feature-flag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("../../../behavior/use-model-providers-settings", () => ({
  useModelProvidersSettings: () => ({
    providers: {},
    modelMetadata: {},
    isLoading: false,
    refetch: vi.fn(),
    hasEnabledProviders: false,
  }),
}));

vi.mock("../../../behavior/model-provider-api", () => {
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

import { MODEL_PROVIDER_FIELD_METADATA } from "../../../model/model-provider-field-metadata";
import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing";
import { EditModelProviderForm } from "../model-provider-form";

const directNote = MODEL_PROVIDER_FIELD_METADATA.azure?.AZURE_OPENAI_API_VERSION?.description;
const gatewayNote = MODEL_PROVIDER_FIELD_METADATA.azure?.AZURE_API_GATEWAY_VERSION?.description;

function renderForm(providerKey: string) {
  return renderWithModelProviderHost(
    <EditModelProviderForm projectId="proj-1" organizationId="org-1" providerKey={providerKey} />,
    new FakeModelProviderHost({ grants: new Set() }),
  );
}

describe("Feature: the Azure drawer says the api-version override is ignored on AI Gateway routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the Azure provider in direct-dispatch mode", () => {
    describe("when the drawer is opened", () => {
      /** @scenario "The Azure provider drawer tells the customer the api-version is ignored on AI Gateway routing" */
      it("explains that the direct-mode api-version is ignored on Gateway routing", async () => {
        renderForm("azure");

        expect(directNote).toBeTruthy();
        expect(directNote).toMatch(/ignored/i);
        expect(directNote).not.toMatch(/bifrost|aigateway/i);
        expect(await screen.findByText(directNote!)).toBeTruthy();
      });
    });
  });

  describe("given the Azure provider switched to API Management gateway mode", () => {
    describe("when the drawer is opened", () => {
      /** @scenario "The Azure provider drawer tells the customer the api-version is ignored on AI Gateway routing" */
      it("explains that the gateway-mode api-version is ignored on Gateway routing", async () => {
        const user = userEvent.setup();
        renderForm("azure");

        await user.click(await screen.findByText("Use API Gateway"));

        expect(gatewayNote).toBeTruthy();
        expect(gatewayNote).toMatch(/ignored/i);
        expect(gatewayNote).not.toMatch(/bifrost|aigateway/i);
        expect(await screen.findByText(gatewayNote!)).toBeTruthy();
      });
    });
  });

  describe("given a non-Azure provider", () => {
    describe("when the drawer is opened", () => {
      /** @scenario "A non-Azure provider drawer shows no api-version note" */
      it("shows no ignored api-version note", async () => {
        renderForm("openai");

        await screen.findByText("OPENAI_API_KEY");
        expect(screen.queryByText(/ignored/i)).toBeNull();
      });
    });
  });
});
