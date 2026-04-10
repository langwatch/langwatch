/**
 * @vitest-environment jsdom
 *
 * Integration tests for EvaluatorTypeSelectorDrawer — Azure Safety BYOK gating.
 *
 * Covers @integration scenarios from specs/evaluators/azure-safety-byok-gating.feature:
 * - "Azure evaluators are disabled when no Azure Safety provider is configured"
 * - "Disabled Azure card shows CTA to configure the provider"
 * - "Configuring Azure Safety enables all three Azure evaluators"
 * - "Non-Azure safety evaluators are unaffected by Azure Safety config"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvaluatorTypeSelectorDrawer } from "../EvaluatorTypeSelectorDrawer";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("~/server/evaluations/evaluators.generated", () => ({
  AVAILABLE_EVALUATORS: {
    "presidio/pii_detection": {
      name: "PII Detection",
      description: "Detect PII in text",
    },
    "azure/content_safety": {
      name: "Azure Content Safety",
      description: "Moderate content with Azure Content Safety",
    },
    "azure/prompt_injection": {
      name: "Azure Prompt Injection",
      description: "Detect prompt injection with Azure Prompt Shield",
    },
    "azure/jailbreak": {
      name: "Azure Jailbreak Detection",
      description: "Detect jailbreak attempts with Azure",
    },
    "openai/moderation": {
      name: "OpenAI Moderation",
      description: "OpenAI moderation endpoint",
    },
    "langevals/competitor_blocklist": {
      name: "Competitor Blocklist",
      description: "Blocklist competitors",
    },
    "langevals/competitor_llm": {
      name: "Competitor LLM",
      description: "LLM competitor check",
    },
    "langevals/competitor_llm_function_call": {
      name: "Competitor LLM Function Call",
      description: "Function call competitor",
    },
    "langevals/off_topic": {
      name: "Off Topic",
      description: "Off-topic detection",
    },
  },
}));

const mockRouterPush = vi.fn();
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    query: {},
    asPath: "/test",
    pathname: "/test",
    replace: vi.fn(),
  }),
}));

const mockOpenDrawer = vi.fn();
const mockCloseDrawer = vi.fn();
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: mockOpenDrawer,
    drawerOpen: vi.fn(() => false),
    canGoBack: false,
    goBack: vi.fn(),
  }),
  getComplexProps: () => ({}),
  useDrawerParams: () => ({}),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "my-project" },
    organization: { id: "org-1" },
  }),
}));

const mockUseAvailableEvaluators = vi.fn();
vi.mock("~/utils/api", () => ({
  api: {
    evaluations: {
      availableEvaluators: {
        useQuery: (...args: unknown[]) => mockUseAvailableEvaluators(...args),
      },
    },
  },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function primeAvailableEvaluators(
  options: { azureConfigured: boolean } = { azureConfigured: false },
) {
  const azureMissing = options.azureConfigured
    ? []
    : ["AZURE_CONTENT_SAFETY_ENDPOINT", "AZURE_CONTENT_SAFETY_KEY"];

  mockUseAvailableEvaluators.mockReturnValue({
    data: {
      "presidio/pii_detection": {
        name: "PII Detection",
        description: "Detect PII in text",
        missingEnvVars: [],
      },
      "azure/content_safety": {
        name: "Azure Content Safety",
        description: "Moderate content with Azure Content Safety",
        missingEnvVars: azureMissing,
      },
      "azure/prompt_injection": {
        name: "Azure Prompt Injection",
        description: "Detect prompt injection with Azure Prompt Shield",
        missingEnvVars: azureMissing,
      },
      "azure/jailbreak": {
        name: "Azure Jailbreak Detection",
        description: "Detect jailbreak attempts with Azure",
        missingEnvVars: azureMissing,
      },
      "openai/moderation": {
        name: "OpenAI Moderation",
        description: "OpenAI moderation endpoint",
        missingEnvVars: [],
      },
      "langevals/competitor_blocklist": {
        name: "Competitor Blocklist",
        description: "Blocklist competitors",
        missingEnvVars: [],
      },
      "langevals/competitor_llm": {
        name: "Competitor LLM",
        description: "LLM competitor check",
        missingEnvVars: [],
      },
      "langevals/competitor_llm_function_call": {
        name: "Competitor LLM Function Call",
        description: "Function call competitor",
        missingEnvVars: [],
      },
      "langevals/off_topic": {
        name: "Off Topic",
        description: "Off-topic detection",
        missingEnvVars: [],
      },
    },
    isLoading: false,
  });
}

const renderDrawer = (props = {}) =>
  render(
    <EvaluatorTypeSelectorDrawer
      open={true}
      category="safety"
      {...props}
    />,
    { wrapper: Wrapper },
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Feature: EvaluatorTypeSelectorDrawer Azure Safety BYOK gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the project has no azure_safety provider configured", () => {
    describe("when the Safety category is opened", () => {
      beforeEach(() => {
        primeAvailableEvaluators({ azureConfigured: false });
        renderDrawer();
      });

      it("marks Azure Content Safety as disabled", async () => {
        await waitFor(() => {
          const card = screen.getByTestId("evaluator-type-azure-content_safety");
          expect(card.getAttribute("data-disabled")).toBe("true");
        });
      });

      it("marks Azure Prompt Injection as disabled", async () => {
        await waitFor(() => {
          const card = screen.getByTestId("evaluator-type-azure-prompt_injection");
          expect(card.getAttribute("data-disabled")).toBe("true");
        });
      });

      it("marks Azure Jailbreak as disabled", async () => {
        await waitFor(() => {
          const card = screen.getByTestId("evaluator-type-azure-jailbreak");
          expect(card.getAttribute("data-disabled")).toBe("true");
        });
      });

      it("shows a Configure Azure Safety CTA on disabled cards", async () => {
        await waitFor(() => {
          const ctas = screen.getAllByText("Configure Azure Safety");
          expect(ctas.length).toBeGreaterThanOrEqual(3);
        });
      });

      it("leaves non-Azure safety evaluators enabled", async () => {
        await waitFor(() => {
          const piiCard = screen.getByTestId(
            "evaluator-type-presidio-pii_detection",
          );
          expect(piiCard.getAttribute("data-disabled")).toBeNull();
        });
      });

      it("does not open evaluatorEditor when clicking a disabled Azure card", async () => {
        const user = userEvent.setup();

        await waitFor(() => {
          expect(
            screen.getByTestId("evaluator-type-azure-content_safety"),
          ).toBeTruthy();
        });

        await user.click(
          screen.getByTestId("evaluator-type-azure-content_safety"),
        );

        expect(mockOpenDrawer).not.toHaveBeenCalled();
      });

      describe("when the user clicks the Configure Azure Safety CTA", () => {
        it("navigates to settings/model-providers preselecting azure_safety", async () => {
          const user = userEvent.setup();

          await waitFor(() => {
            expect(
              screen.getByTestId(
                "evaluator-type-azure-content_safety-cta",
              ),
            ).toBeTruthy();
          });

          await user.click(
            screen.getByTestId("evaluator-type-azure-content_safety-cta"),
          );

          expect(mockRouterPush).toHaveBeenCalledWith(
            "/settings/model-providers?provider=azure_safety",
          );
        });
      });
    });
  });

  describe("given the project has azure_safety configured with valid keys", () => {
    describe("when the Safety category is opened", () => {
      beforeEach(() => {
        primeAvailableEvaluators({ azureConfigured: true });
        renderDrawer();
      });

      it("leaves Azure Content Safety enabled", async () => {
        await waitFor(() => {
          const card = screen.getByTestId(
            "evaluator-type-azure-content_safety",
          );
          expect(card.getAttribute("data-disabled")).toBeNull();
        });
      });

      it("leaves Azure Prompt Injection enabled", async () => {
        await waitFor(() => {
          const card = screen.getByTestId(
            "evaluator-type-azure-prompt_injection",
          );
          expect(card.getAttribute("data-disabled")).toBeNull();
        });
      });

      it("leaves Azure Jailbreak enabled", async () => {
        await waitFor(() => {
          const card = screen.getByTestId("evaluator-type-azure-jailbreak");
          expect(card.getAttribute("data-disabled")).toBeNull();
        });
      });

      it("opens evaluatorEditor when clicking an Azure card", async () => {
        const user = userEvent.setup();

        await waitFor(() => {
          expect(
            screen.getByTestId("evaluator-type-azure-content_safety"),
          ).toBeTruthy();
        });

        await user.click(
          screen.getByTestId("evaluator-type-azure-content_safety"),
        );

        expect(mockOpenDrawer).toHaveBeenCalledWith(
          "evaluatorEditor",
          expect.objectContaining({
            evaluatorType: "azure/content_safety",
          }),
        );
      });
    });
  });
});
