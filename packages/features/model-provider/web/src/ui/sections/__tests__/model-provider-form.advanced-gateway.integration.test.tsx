/**
 * @vitest-environment jsdom
 *
 * Integration tests for the "Advanced (Gateway)" accordion on
 * EditModelProviderForm.
 *
 * Covers @integration scenarios from
 * specs/ai-gateway/gateway-provider-settings.feature:
 *   /** @scenario Advanced (Gateway) is hidden when the AI gateway feature flag is off
 *   /** @scenario Advanced (Gateway) renders as a collapsed accordion when the flag is on
 *   /** @scenario Single Save persists basic credentials and advanced gateway fields together
 *
 * The drawer renders the gateway fields inside a collapsible "Advanced"
 * accordion, gated on the `release_ui_ai_gateway_menu_enabled` flag for the
 * caller's org. The accordion also holds fields that are not the gateway's,
 * so the flag gates the fields rather than the accordion. There is one Save:
 * it funnels basic + advanced to one `modelProvider.update` mutation.
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseFeatureFlag, EXISTING_PROVIDER } = vi.hoisted(() => ({
  mockUseFeatureFlag: vi.fn(),
  EXISTING_PROVIDER: {
    id: "mp_existing",
    provider: "openai",
    name: "OpenAI",
    enabled: true,
    disabledAt: null,
    healthStatus: null,
    customKeys: { OPENAI_API_KEY: "sk-stored" },
    deploymentMapping: null,
    scopes: [],
    models: ["openai/gpt-4o"],
    embeddingsModels: ["openai/text-embedding-3-small"],
    customModels: [],
    customEmbeddingsModels: [],
    rateLimitRpm: 600,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: 1,
    providerConfig: { region: "us-east-1" },
  },
}));

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn(), openDrawer: vi.fn() }),
}));

vi.mock("@langwatch/workflow-web/surfaces/feature-flag", () => ({
  useFeatureFlag: (...args: unknown[]) => mockUseFeatureFlag(...args),
}));

vi.mock("../../../behavior/use-model-providers-settings", () => ({
  useModelProvidersSettings: () => ({
    providers: { openai: EXISTING_PROVIDER },
    modelMetadata: {},
    isLoading: false,
    refetch: vi.fn(),
    hasEnabledProviders: true,
  }),
}));

vi.mock("../../../behavior/model-provider-api", () => {
  const query = (data: unknown) => ({
    useQuery: () => ({ data, isLoading: false, isSuccess: true, refetch: vi.fn() }),
  });
  const modelProvider = {
    isManagedProvider: query({ managed: false }),
    listAllForOrganizationForFrontend: query([EXISTING_PROVIDER]),
    listAllForProjectForFrontend: query([EXISTING_PROVIDER]),
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

import { EditModelProviderForm } from "../model-provider-form";
import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing";

function renderForm() {
  return renderWithModelProviderHost(
    <EditModelProviderForm
      projectId="proj-1"
      organizationId="org-1"
      modelProviderId="mp_existing"
      providerKey="openai"
    />,
    new FakeModelProviderHost(),
  );
}

function primeFlag({ gatewayEnabled }: { gatewayEnabled: boolean }) {
  mockUseFeatureFlag.mockImplementation((flag: string) =>
    flag === "release_ui_ai_gateway_menu_enabled"
      ? { enabled: gatewayEnabled, isLoading: false }
      : { enabled: false, isLoading: false },
  );
}

describe("Feature: Advanced (Gateway) accordion on ModelProvider drawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the AI gateway feature flag is OFF for the org", () => {
    describe("when the drawer renders for openai", () => {
      beforeEach(() => {
        primeFlag({ gatewayEnabled: false });
        renderForm();
      });

      /** @scenario Advanced (Gateway) is hidden when the AI gateway feature flag is off */
      it("renders no gateway field under the Advanced accordion", () => {
        // The accordion itself stays, because it also holds the models
        // allowed to skip Langy permission checks. What the flag gates is
        // the gateway's own fields, so those are what this asserts on.
        expect(screen.queryByPlaceholderText(/no cap/i)).toBeNull();
        expect(screen.queryByText(/fallback priority/i)).toBeNull();
        expect(screen.queryByText(/provider config \(json\)/i)).toBeNull();
      });

      it("does not render any rate-limit input", () => {
        expect(screen.queryByPlaceholderText(/no cap/i)).toBeNull();
      });

      it("still renders the main Save button", async () => {
        expect(await screen.findByRole("button", { name: /^save$/i })).toBeTruthy();
      });
    });
  });

  describe("given the AI gateway feature flag is ON for the org", () => {
    describe("when the drawer renders for openai", () => {
      beforeEach(() => {
        primeFlag({ gatewayEnabled: true });
        renderForm();
      });

      /** @scenario Advanced (Gateway) renders as a collapsed accordion when the flag is on */
      it("renders the Advanced accordion trigger", async () => {
        expect(await screen.findByText("Advanced")).toBeTruthy();
      });

      it("keeps the rate-limit inputs hidden until the accordion is expanded", async () => {
        await screen.findByText("Advanced");
        // Collapsed-by-default: the accordion content is in the DOM but
        // hidden from accessibility queries via `hidden` attribute. We
        // assert no rate-limit input is exposed.
        const placeholderMatches = screen.queryAllByPlaceholderText(/no cap/i);
        const visible = placeholderMatches.filter((el) => !el.closest("[hidden]"));
        expect(visible).toHaveLength(0);
      });

      // Render-side surface for the single-Save scenario. Wire-level
      // assertion (the payload actually carries basic + advanced
      // together) lives in use-provider-form-submit.integration.test.tsx
      // and binds the same scenario name.
      it("renders only one Save button (no separate Save Advanced)", async () => {
        await screen.findByText("Advanced");
        expect(screen.queryByText(/save advanced/i)).toBeNull();
        const saveButtons = screen.getAllByRole("button", {
          name: /^save$/i,
        });
        expect(saveButtons).toHaveLength(1);
      });

      /** @scenario "A saved gateway rate limit reopens as saved" */
      it("seeds the expanded fields from the stored row rather than the registry default", async () => {
        fireEvent.click(await screen.findByText("Advanced"));

        expect(await screen.findByDisplayValue("600")).toBeTruthy();
        expect(screen.getByDisplayValue("1")).toBeTruthy();
        expect(screen.getByDisplayValue(/"region": ?"us-east-1"/)).toBeTruthy();
      });
    });
  });
});
