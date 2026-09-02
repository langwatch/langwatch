/**
 * @vitest-environment jsdom
 *
 * The standalone chat address for a published workflow.
 *
 * THE PLATFORM PAGE HAD NO SUITE EITHER, and the two things worth pinning are
 * the two states a reader can land in: a workflow with nothing published says
 * so, and one with a published version renders its entry fields and runs over
 * `optimization.chat` — the only run path this address has ever taken.
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { blankTemplate, entryNode as blankTemplateEntryNode } from "../../../model/templates/blank.template";
import { FakeWorkflowHost, renderWithWorkflowHost } from "../../../testing";
import WorkflowChatScreen from "../workflow-chat.screen";

const { state } = vi.hoisted(() => ({
  state: {
    published: null as unknown,
    isLoading: false,
  },
}));

const calls = vi.hoisted(() => ({ chat: vi.fn() }));

vi.mock("../../../behavior/workflow-api", () => ({
  workflowApi: {
    useUtils: () => ({ workflow: { getAll: { invalidate: vi.fn() } } }),
    optimization: {
      getPublishedWorkflow: {
        useQuery: () => ({ data: state.published, isLoading: state.isLoading }),
      },
      chat: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async (input: unknown) => calls.chat(input),
        }),
      },
    },
  },
}));

/**
 * A published graph with ONE entry field, which is the single-input layout.
 *
 * Built from the package's own blank template rather than hand-written: the
 * screen calls `parseStudioWorkflow`, which is `studioWorkflowSchema.parse` and
 * THROWS on anything that is not a whole graph, so a hand-rolled fixture pins
 * the schema instead of the screen.
 */
const publishedWithOneInput = {
  dsl: {
    ...blankTemplate,
    edges: [
      {
        id: "e1",
        source: "entry",
        sourceHandle: "outputs.question",
        target: "end",
        targetHandle: "inputs.answer",
        type: "default",
      },
    ],
    nodes: [
      {
        ...blankTemplateEntryNode(),
        data: {
          ...blankTemplateEntryNode().data,
          outputs: [{ identifier: "question", type: "str" }],
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 600, y: 0 },
        data: { name: "End", inputs: [{ identifier: "answer", type: "str" }] },
      },
    ],
  },
};

describe("given the standalone chat address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.published = null;
    state.isLoading = false;
  });
  afterEach(() => cleanup());

  describe("when nothing is published for the workflow", () => {
    it("says so rather than rendering an empty chat", () => {
      renderWithWorkflowHost(
        <WorkflowChatScreen />,
        new FakeWorkflowHost({ params: { workflow: "wf_1" } }),
      );

      expect(screen.getByText("Workflow not found.")).toBeTruthy();
    });
  });

  describe("when a published version exists", () => {
    it("runs the workflow over the published endpoint and shows what came back", async () => {
      const user = userEvent.setup();
      state.published = publishedWithOneInput;
      calls.chat.mockResolvedValue({ status: "success", result: { answer: "Refund issued" } });

      renderWithWorkflowHost(
        <WorkflowChatScreen />,
        new FakeWorkflowHost({ params: { workflow: "wf_1" } }),
      );

      const field = await screen.findByPlaceholderText(/send question/i);
      await user.type(field, "Where is my order?{Enter}");

      await waitFor(() => expect(calls.chat).toHaveBeenCalledTimes(1));
      expect(calls.chat.mock.calls[0]?.[0]).toMatchObject({
        workflowId: "wf_1",
        projectId: "project-1",
      });
      expect(await screen.findByText(/answer: Refund issued/)).toBeTruthy();
    });
  });
});
