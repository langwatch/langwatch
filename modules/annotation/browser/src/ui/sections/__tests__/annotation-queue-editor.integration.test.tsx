/**
 * @vitest-environment jsdom
 * Pins the queue editor: hydration, the pick triggers, the refusal and the save payload.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithAnnotationHost } from "../../../testing.tsx";
import { AnnotationQueueEditor } from "../annotation-queue-editor.tsx";

const mocks = vi.hoisted(() => {
  const state: { queue: unknown; saved: unknown[] } = { queue: undefined, saved: [] };
  return state;
});

vi.mock("../../../behavior/annotation-api.ts", () => ({
  annotationApi: {
    useUtils: () => ({ annotation: new Proxy({}, { get: () => ({ invalidate: () => void 0 }) }) }),
    annotation: {
      getQueueBySlugOrId: { useQuery: () => ({ data: mocks.queue }) },
      createOrUpdateQueue: {
        useMutation: (handlers: { onSuccess: (saved: { name: string }) => void }) => ({
          mutate: (input: { name: string }) => {
            mocks.saved.push(input);
            handlers.onSuccess({ name: input.name });
          },
        }),
      },
    },
    annotationScore: {
      getAllActive: {
        useQuery: () => ({
          data: [
            { id: "score-1", name: "Accuracy" },
            { id: "score-2", name: "Tone" },
          ],
        }),
      },
    },
    organization: {
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({
          data: {
            members: [
              { user: { id: "user-1", name: "Ana" } },
              { user: { id: "user-2", name: "Bo" } },
            ],
          },
        }),
      },
    },
  },
}));

function renderEditor(queueId?: string) {
  const onSaved = vi.fn<(name: string) => void>();
  renderWithAnnotationHost(
    <AnnotationQueueEditor
      projectId="proj-1"
      organizationId="org-1"
      queueId={queueId}
      onClose={() => void 0}
      onSaved={onSaved}
      onFailed={() => void 0}
    />,
  );
  return onSaved;
}

beforeEach(() => {
  mocks.queue = undefined;
  mocks.saved = [];
});

afterEach(() => cleanup());

describe("given a new queue", () => {
  it("shows both pick placeholders and refuses a save with nothing picked", async () => {
    renderEditor();
    expect(screen.getByText("Create Annotation Queue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Participants/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Score Type/ })).toBeInTheDocument();
    const [nameInput, descriptionInput] = screen.getAllByRole("textbox");
    fireEvent.change(nameInput!, { target: { value: "Q" } });
    fireEvent.change(descriptionInput!, { target: { value: "D" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Pick at least one participant and one score type.",
    );
    expect(mocks.saved).toEqual([]);
  });

  it("toggles picks on and off and saves the picked ids", async () => {
    const user = userEvent.setup();
    const onSaved = renderEditor();
    await user.click(screen.getByRole("button", { name: /Add Participants/ }));
    await user.click(await screen.findByRole("button", { name: /Bo/ }));
    await user.click(screen.getByRole("button", { name: /Ana/ }));
    await user.click(screen.getByRole("button", { name: /Ana/, pressed: true }));
    await user.click(screen.getByRole("button", { name: /Add Score Type/ }));
    await user.click(await screen.findByRole("button", { name: /Tone/ }));
    const [nameInput, descriptionInput] = screen.getAllByRole("textbox");
    fireEvent.change(nameInput!, { target: { value: "Q" } });
    fireEvent.change(descriptionInput!, { target: { value: "D" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.saved).toEqual([
      {
        projectId: "proj-1",
        name: "Q",
        description: "D",
        userIds: ["user-2"],
        scoreTypeIds: ["score-2"],
      },
    ]);
    expect(onSaved).toHaveBeenCalledWith("Q");
  });
});

describe("given a stored queue", () => {
  it("hydrates the form and saves under the queue's id", () => {
    mocks.queue = {
      name: "Stored",
      description: null,
      members: [{ user: { id: "user-1", name: "Ana" } }],
      AnnotationQueueScores: [{ annotationScore: { id: "score-1", name: "Accuracy" } }],
    };
    renderEditor("queue-9");
    expect(screen.getByText("Edit Annotation Queue")).toBeInTheDocument();
    expect(screen.queryByText("Add Participants")).toBeNull();
    expect(screen.queryByText("Add Score Type")).toBeNull();
    expect(screen.getAllByText("Ana").length).toBeGreaterThan(0);
    fireEvent.change(screen.getAllByRole("textbox")[1]!, { target: { value: "Now described" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.saved).toEqual([
      {
        projectId: "proj-1",
        name: "Stored",
        description: "Now described",
        userIds: ["user-1"],
        scoreTypeIds: ["score-1"],
        queueId: "queue-9",
      },
    ]);
  });
});
