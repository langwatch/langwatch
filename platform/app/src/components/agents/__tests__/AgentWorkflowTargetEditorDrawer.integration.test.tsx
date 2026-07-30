/**
 * @vitest-environment jsdom
 *
 * Integration tests for AgentWorkflowTargetEditorDrawer.
 *
 * A workflow-type agent target has no code of its own to edit inline — the
 * drawer must show the linked workflow as a card with a link to open the
 * real Studio graph editor in a new tab, plus the same input-mapping UI
 * every other agent target type already gets.
 *
 * @see specs/agents/workflow-agent-as-target.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentWorkflowTargetEditorDrawer } from "../AgentWorkflowTargetEditorDrawer";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    query: { project: "test-project" },
    asPath: "/test",
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
    organization: { id: "test-org" },
    team: null,
  }),
}));

const mockCloseDrawer = vi.fn();
const mockGoBack = vi.fn();

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: vi.fn(),
    drawerOpen: vi.fn(() => false),
    canGoBack: false,
    goBack: mockGoBack,
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => ({}),
}));

const mockOnMappingChange = vi.fn();

let agentQueryData: unknown = null;
let workflowQueryData: unknown = null;

vi.mock("~/utils/api", () => ({
  api: {
    agents: {
      getById: {
        useQuery: () => ({ data: agentQueryData, isLoading: false }),
      },
    },
    workflow: {
      getById: {
        useQuery: () => ({ data: workflowQueryData, isLoading: false }),
      },
    },
  },
}));

const renderDrawer = (
  props: Partial<
    React.ComponentProps<typeof AgentWorkflowTargetEditorDrawer>
  > = {},
) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AgentWorkflowTargetEditorDrawer
        open={true}
        agentId="agent-1"
        onInputMappingsChange={mockOnMappingChange}
        {...props}
      />
    </ChakraProvider>,
  );

describe("AgentWorkflowTargetEditorDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentQueryData = {
      id: "agent-1",
      name: "fast resolution agent",
      type: "workflow",
      workflowId: "workflow-123",
      config: {},
    };
    workflowQueryData = {
      id: "workflow-123",
      name: "fast resolution agent workflow",
      icon: "🦊",
      updatedAt: new Date("2026-07-17T12:00:00Z"),
      currentVersion: {
        dsl: {
          nodes: [
            {
              id: "entry",
              type: "entry",
              data: { outputs: [{ identifier: "question", type: "str" }] },
            },
          ],
          edges: [],
        },
      },
    };
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a workflow-type agent target", () => {
    describe("when the drawer opens with a resolved workflow", () => {
      /** @scenario Editing the target opens a mapping drawer, not a dead end */
      it("renders the linked workflow's name with a link to open it in Studio", () => {
        renderDrawer();

        expect(
          screen.getByText("fast resolution agent workflow"),
        ).toBeInTheDocument();

        expect(screen.getByTestId("open-workflow-link")).toHaveAttribute(
          "href",
          "/test-project/studio/workflow-123",
        );
      });

      /** @scenario Editing the target opens a mapping drawer, not a dead end */
      it("opens the Studio editor in a new tab rather than inside the sidebar", () => {
        renderDrawer();

        expect(screen.getByTestId("open-workflow-link")).toHaveAttribute(
          "target",
          "_blank",
        );
      });

      /** @scenario Editing the target opens a mapping drawer, not a dead end */
      it("renders the workflow's real input fields for mapping, not a code editor", () => {
        renderDrawer();

        expect(screen.getByText("question")).toBeInTheDocument();
      });

      /** @scenario Mapping a dataset column to a workflow input field */
      it("renders a Close button and no Save button, since mappings persist immediately", () => {
        renderDrawer();

        expect(screen.getByTestId("close-drawer-button")).toBeInTheDocument();
        expect(screen.queryByText(/save/i)).not.toBeInTheDocument();
      });
    });

    describe("when the user maps a dataset column onto a workflow input", () => {
      const datasetSource = {
        id: "dataset-1",
        name: "Support tickets",
        type: "dataset" as const,
        fields: [
          { name: "customer_message", type: "str" },
          { name: "expected_output", type: "str" },
        ],
      };

      /** @scenario Mapping a dataset column to a workflow input field */
      it("records the mapping the moment the column is picked, with nothing left to save", async () => {
        const user = userEvent.setup();
        renderDrawer({ availableSources: [datasetSource] });

        await user.click(screen.getByRole("textbox"));

        await waitFor(() =>
          expect(screen.getByText("customer_message")).toBeInTheDocument(),
        );
        await user.click(screen.getByText("customer_message"));

        expect(mockOnMappingChange).toHaveBeenCalledWith("question", {
          type: "source",
          sourceId: "dataset-1",
          path: ["customer_message"],
        });
        // Immediately: the drawer never grew a save control to press.
        expect(screen.queryByText(/save/i)).not.toBeInTheDocument();
      });

      /** @scenario Mapping a dataset column to a workflow input field */
      it("shows the mapped column back to the user on the question field", () => {
        renderDrawer({
          availableSources: [datasetSource],
          inputMappings: {
            question: {
              type: "source",
              sourceId: "dataset-1",
              path: ["customer_message"],
            },
          },
        });

        expect(screen.getByTestId("source-mapping-tag")).toHaveTextContent(
          "customer_message",
        );
      });
    });

    describe("when the workflow has no declared entry outputs", () => {
      it("renders a generic input field as a fallback", () => {
        workflowQueryData = {
          id: "workflow-123",
          name: "empty workflow",
          currentVersion: {
            dsl: {
              nodes: [{ id: "entry", type: "entry", data: {} }],
              edges: [],
            },
          },
        };

        renderDrawer();

        expect(screen.getByText("input")).toBeInTheDocument();
      });
    });

    describe("when the agent or its linked workflow fails to load", () => {
      it("renders an error message instead of a mapping UI for an unresolved workflow", () => {
        workflowQueryData = null;

        renderDrawer();

        expect(screen.getByTestId("workflow-lookup-error")).toBeInTheDocument();
        expect(screen.queryByText("input")).not.toBeInTheDocument();
      });

      it("renders an error message instead of a mapping UI for an unresolved agent", () => {
        agentQueryData = null;

        renderDrawer();

        expect(screen.getByTestId("workflow-lookup-error")).toBeInTheDocument();
      });
    });
  });
});
