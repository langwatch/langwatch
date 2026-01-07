/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AddModelProviderForm,
} from "../ModelProviderForm";

// Mock dependencies
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    query: {},
    asPath: "/test",
  }),
}));

const mockCloseDrawer = vi.fn();

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: vi.fn(),
    canGoBack: false,
    goBack: vi.fn(),
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: {
      id: "test-project-id",
      defaultModel: "openai/gpt-4o",
      topicClusteringModel: "openai/gpt-4o",
      embeddingsModel: "openai/text-embedding-3-small",
    },
    organization: { id: "test-org-id" },
    team: { id: "test-team-id" },
  }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("../../server/modelProviders/iconsMap", () => ({
  modelProviderIcons: {
    openai: <span>OpenAI Icon</span>,
    anthropic: <span>Anthropic Icon</span>,
  },
}));

// Mock dependencies injection
vi.mock("../../injection/dependencies.client", () => ({
  dependencies: {
    managedModelProviderComponent: undefined,
  },
}));

const mockUpdateMutation = vi.fn();
const mockUpdateDefaultModelMutation = vi.fn();
const mockUpdateTopicClusteringModelMutation = vi.fn();
const mockUpdateEmbeddingsModelMutation = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    modelProvider: {
      update: {
        useMutation: () => ({
          mutateAsync: mockUpdateMutation,
          isPending: false,
        }),
      },
      getAll: {
        useQuery: () => ({
          data: {
            openai: {
              id: "provider-1",
              provider: "openai",
              enabled: true,
              customKeys: { OPENAI_API_KEY: "test-key" },
              models: null,
              embeddingsModels: null,
              disabledByDefault: false,
              deploymentMapping: null,
              extraHeaders: [],
            },
          },
          isLoading: false,
        }),
      },
    },
    project: {
      updateDefaultModel: {
        useMutation: () => ({
          mutateAsync: mockUpdateDefaultModelMutation,
          isPending: false,
        }),
      },
      updateTopicClusteringModel: {
        useMutation: () => ({
          mutateAsync: mockUpdateTopicClusteringModelMutation,
          isPending: false,
        }),
      },
      updateEmbeddingsModel: {
        useMutation: () => ({
          mutateAsync: mockUpdateEmbeddingsModelMutation,
          isPending: false,
        }),
      },
    },
    useContext: () => ({
      modelProvider: {
        getAll: { invalidate: vi.fn() },
      },
      project: {
        get: { invalidate: vi.fn() },
      },
    }),
  },
}));

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("AddModelProviderForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMutation.mockResolvedValue({});
    mockUpdateDefaultModelMutation.mockResolvedValue({});
    mockUpdateTopicClusteringModelMutation.mockResolvedValue({});
    mockUpdateEmbeddingsModelMutation.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  describe("Basic rendering", () => {
    it("renders credential input fields", () => {
      render(
        <AddModelProviderForm
          projectId="test-project"
          provider="openai"
          currentDefaultModel="openai/gpt-4o"
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("OPENAI_API_KEY")).toBeInTheDocument();
    });

    it("renders Save button", () => {
      render(
        <AddModelProviderForm
          projectId="test-project"
          provider="openai"
          currentDefaultModel="openai/gpt-4o"
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    });
  });

  describe("Azure provider", () => {
    it("shows Use API Gateway toggle for Azure provider", () => {
      render(
        <AddModelProviderForm
          projectId="test-project"
          provider="azure"
          currentDefaultModel="openai/gpt-4o"
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("Use API Gateway")).toBeInTheDocument();
    });
  });

  describe("Custom provider", () => {
    it("shows custom model input for custom provider", () => {
      render(
        <AddModelProviderForm
          projectId="test-project"
          provider="custom"
          currentDefaultModel="openai/gpt-4o"
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("Models")).toBeInTheDocument();
      expect(
        screen.getByText(/Use this option for LiteLLM proxy/i)
      ).toBeInTheDocument();
    });
  });

  describe("Credential management", () => {
    it("renders credential input field", async () => {
      render(
        <AddModelProviderForm
          projectId="test-project"
          provider="openai"
          currentDefaultModel="openai/gpt-4o"
        />,
        { wrapper: Wrapper }
      );

      // Check that credential field label is present
      expect(screen.getByText("OPENAI_API_KEY")).toBeInTheDocument();
    });
  });
});

