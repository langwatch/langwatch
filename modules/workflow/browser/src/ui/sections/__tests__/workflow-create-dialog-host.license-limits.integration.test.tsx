/**
 * @vitest-environment jsdom
 * A workflow created past the plan's limit is refused, and the licence handler
 * answers the refusal with its upgrade modal. This proves the form's half: it
 * adds no toast atop an answered refusal, and still reports one nothing answered.
 * @see specs/licensing/enforcement-resources.feature
 */
import { markHandledGlobally } from "@langwatch/browser-host/errors";
import { BrowserUiFeedback } from "@langwatch/browser-host/feedback";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  refuse: undefined as undefined | (() => Error),
  toasts: [] as string[],
  navigate: vi.fn(),
}));

vi.mock("../../../behavior/workflow-api.ts", () => {
  const idle = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    workflowApi: {
      useUtils: () => ({ workflow: { getAll: { invalidate: vi.fn() } } }),
      workflow: {
        create: {
          useMutation: () => ({
            mutate: (_input: unknown, handlers: { onError?: (error: Error) => void }) =>
              handlers.onError?.(calls.refuse?.() ?? new Error("network down")),
            mutateAsync: vi.fn(),
            isPending: false,
          }),
        },
        archive: { useMutation: idle },
        cascadeArchive: { useMutation: idle },
        syncFromSource: { useMutation: idle },
        getRelatedEntities: { useQuery: () => ({ data: undefined, isLoading: false }) },
      },
    },
  };
});

const feedback = BrowserUiFeedback.create({
  create: (toast) => void calls.toasts.push(toast.title),
});

vi.mock("../../../model/workflow-host.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkflowHost: () => ({
    scope: () => ({ projectId: "project_1", projectSlug: "project-one" }),
    navigate: calls.navigate,
    failed: (failure: Parameters<typeof feedback.failed>[0]) => feedback.failed(failure),
  }),
}));

vi.mock("../../blocks/workflow-emoji-picker.tsx", () => ({
  WorkflowEmojiPicker: () => null,
}));

import { WorkflowCreateDialogHost } from "../workflow-create-dialog-host.tsx";

/** A limit refusal the licence handler has already answered with its upgrade modal. */
const answeredLimitRefusal = () => {
  const error = new Error("Refused");
  (error as { data?: unknown }).data = {
    code: "FORBIDDEN",
    httpStatus: 403,
    cause: { limitType: "workflows", current: 3, max: 3 },
  };
  markHandledGlobally(error);
  return error;
};

const submitNewWorkflowForm = async () => {
  renderWithDesignSystem(<WorkflowCreateDialogHost open onClose={vi.fn()} />);
  fireEvent.click(within(screen.getByTestId("new-workflow-card-blank")).getByRole("button"));
  fireEvent.click(await screen.findByTestId("workflow-create-submit"));
};

describe("submitting the new workflow form past the workflow limit", () => {
  beforeEach(() => {
    calls.toasts.length = 0;
    calls.refuse = undefined;
  });
  afterEach(cleanup);

  /** @scenario "Workflow creation error toast suppressed when license modal shown" */
  it("adds no toast of its own to the refusal the licence handler answered", async () => {
    calls.refuse = answeredLimitRefusal;

    await submitNewWorkflowForm();

    await waitFor(() => expect(screen.getByTestId("workflow-create-submit")).toBeEnabled());
    expect(calls.toasts).toEqual([]);
    expect(calls.navigate).not.toHaveBeenCalled();
  });

  /** @scenario "Non-license errors still show toast" */
  it("reports a refusal that is not a licence limit, because nothing else did", async () => {
    await submitNewWorkflowForm();

    await waitFor(() => expect(calls.toasts).toContain("Couldn't create workflow"));
  });
});
