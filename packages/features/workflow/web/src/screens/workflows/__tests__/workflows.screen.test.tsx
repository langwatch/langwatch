/**
 * @vitest-environment jsdom
 *
 * The workflows library: what a reader sees, where a card takes them, and what
 * deleting one would take with it.
 *
 * THE PLATFORM PAGE HAD NO RENDER SUITE AT ALL. `pages/[project]/workflows.tsx`
 * and the card underneath it carried an empty state, a create dialog, a
 * two-branch delete and three overlays, and nothing mounted any of it. These
 * are those behaviours, stated for the first time.
 *
 * WHAT THIS FILE IS REALLY FOR is the delete. A workflow's cascade ARCHIVES the
 * evaluators and agents bound to it and DELETES every online evaluation those
 * evaluators back, in production, with no undo on this screen — so the two
 * things worth pinning are that the reader is told before they confirm, and
 * that the branch is chosen by what the related-entities read actually answered
 * rather than by which button was pressed.
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeWorkflowHost, renderWithWorkflowHost } from "../../../testing";
import WorkflowsScreen from "../workflows.screen";

const { state } = vi.hoisted(() => ({
  state: {
    workflows: [] as Array<Record<string, unknown>>,
    isLoading: false,
    related: {
      evaluators: [] as Array<{ id: string; name: string }>,
      agents: [] as Array<{ id: string; name: string }>,
      monitors: [] as Array<{ id: string; name: string }>,
    },
    relatedLoading: false,
  },
}));

const calls = vi.hoisted(() => ({
  archive: vi.fn(),
  cascadeArchive: vi.fn(),
  syncFromSource: vi.fn(),
  invalidateAll: vi.fn(),
}));

vi.mock("../../../behavior/workflow-api", () => {
  const mutation = (spy: (input: unknown) => unknown) => ({
    useMutation: () => ({
      isPending: false,
      mutate: (
        input: unknown,
        perCall?: { onSuccess?: (result: unknown) => void; onError?: (error: unknown) => void },
      ) => {
        const result = spy(input);
        perCall?.onSuccess?.(result);
      },
      mutateAsync: async (input: unknown) => spy(input),
    }),
  });

  return {
    workflowApi: {
      useUtils: () => ({ workflow: { getAll: { invalidate: calls.invalidateAll } } }),
      workflow: {
        getAll: { useQuery: () => ({ data: state.workflows, isLoading: state.isLoading }) },
        getRelatedEntities: {
          useQuery: () => ({ data: state.related, isLoading: state.relatedLoading }),
        },
        getCopies: { useQuery: () => ({ data: [], isLoading: false, error: null }) },
        archive: mutation(calls.archive),
        cascadeArchive: mutation(calls.cascadeArchive),
        syncFromSource: mutation(calls.syncFromSource),
        copy: mutation(vi.fn()),
        pushToCopies: mutation(vi.fn()),
        create: mutation(vi.fn()),
      },
    },
  };
});

const workflowRow = (overrides: Record<string, unknown> = {}) => ({
  id: "wf_1",
  projectId: "project-1",
  name: "Summarise support tickets",
  icon: "🧩",
  description: null,
  updatedAt: new Date("2026-09-01T10:00:00Z"),
  copiedFromWorkflowId: null,
  copiedFrom: null,
  _count: { copiedWorkflows: 0 },
  ...overrides,
});

describe("given the workflows library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.workflows = [];
    state.isLoading = false;
    state.related = { evaluators: [], agents: [], monitors: [] };
    state.relatedLoading = false;
  });
  afterEach(() => cleanup());

  describe("when the project has no workflows", () => {
    it("offers the first one rather than an empty grid", () => {
      renderWithWorkflowHost(<WorkflowsScreen />);

      expect(screen.getByText("No workflows yet")).toBeTruthy();
      expect(screen.getByRole("button", { name: /create your first workflow/i })).toBeTruthy();
    });
  });

  describe("when the project has workflows", () => {
    it("lists them", () => {
      state.workflows = [workflowRow(), workflowRow({ id: "wf_2", name: "Route to the right team" })];

      renderWithWorkflowHost(<WorkflowsScreen />);

      expect(screen.getByText("Summarise support tickets")).toBeTruthy();
      expect(screen.getByText("Route to the right team")).toBeTruthy();
    });

    it("opens the studio for the workflow the reader clicked", async () => {
      const user = userEvent.setup();
      state.workflows = [workflowRow()];

      const { host } = renderWithWorkflowHost(<WorkflowsScreen />);
      await user.click(screen.getByText("Summarise support tickets"));

      expect(host.navigations).toEqual(["/my-project/studio/wf_1"]);
    });

    it("does not open the studio when the click landed in the row menu", async () => {
      const user = userEvent.setup();
      state.workflows = [workflowRow()];

      const { host } = renderWithWorkflowHost(<WorkflowsScreen />);
      await user.click(screen.getByRole("button", { name: /workflow actions/i }));

      expect(host.navigations).toEqual([]);
    });
  });

  describe("when a workflow with nothing bound to it is deleted", () => {
    it("takes the plain delete and never the cascade", async () => {
      const user = userEvent.setup();
      state.workflows = [workflowRow()];

      renderWithWorkflowHost(<WorkflowsScreen />);
      await user.click(screen.getByRole("button", { name: /workflow actions/i }));
      await user.click(await screen.findByText("Delete"));

      const confirm = await screen.findByTestId("cascade-archive-confirm-input");
      await user.type(confirm, "delete");
      await user.click(screen.getByTestId("cascade-archive-confirm-button"));

      await waitFor(() => expect(calls.archive).toHaveBeenCalledTimes(1));
      expect(calls.cascadeArchive).not.toHaveBeenCalled();
    });
  });

  describe("when a workflow with evaluators bound to it is deleted", () => {
    it("names what goes with it before the reader confirms, and takes the cascade", async () => {
      const user = userEvent.setup();
      state.workflows = [workflowRow()];
      state.related = {
        evaluators: [{ id: "ev_1", name: "Answer relevance" }],
        agents: [],
        monitors: [{ id: "mo_1", name: "Nightly relevance" }],
      };
      calls.cascadeArchive.mockReturnValue({
        archivedEvaluatorsCount: 1,
        archivedAgentsCount: 0,
        deletedMonitorsCount: 1,
      });

      const { host } = renderWithWorkflowHost(<WorkflowsScreen />);
      await user.click(screen.getByRole("button", { name: /workflow actions/i }));
      await user.click(await screen.findByText("Delete"));

      // The names, before the confirmation is possible.
      expect(await screen.findByText("Answer relevance")).toBeTruthy();
      expect(screen.getByText("Nightly relevance")).toBeTruthy();

      const confirm = screen.getByTestId("cascade-archive-confirm-input");
      await user.type(confirm, "delete");
      await user.click(screen.getByTestId("cascade-archive-confirm-button"));

      await waitFor(() => expect(calls.cascadeArchive).toHaveBeenCalledTimes(1));
      expect(calls.archive).not.toHaveBeenCalled();
      expect(host.successes[0]?.description).toContain("1 evaluator");
      expect(host.successes[0]?.description).toContain("1 online evaluation");
    });
  });

  describe("when a replicated workflow is updated from its source", () => {
    it("reports the update through the host rather than composing its own toast", async () => {
      const user = userEvent.setup();
      state.workflows = [
        workflowRow({
          copiedFromWorkflowId: "wf_source",
          copiedFrom: {
            id: "wf_source",
            name: "Summarise support tickets",
            projectId: "project-2",
            project: {
              id: "project-2",
              name: "Support",
              team: { id: "t1", name: "Platform", organization: { id: "o1", name: "Acme" } },
            },
          },
        }),
      ];

      const { host } = renderWithWorkflowHost(<WorkflowsScreen />);
      await user.click(screen.getByRole("button", { name: /workflow actions/i }));
      await user.click(await screen.findByText("Update from source"));

      await waitFor(() => expect(calls.syncFromSource).toHaveBeenCalledTimes(1));
      expect(host.successes[0]?.title).toBe("Workflow updated");
    });
  });
});
