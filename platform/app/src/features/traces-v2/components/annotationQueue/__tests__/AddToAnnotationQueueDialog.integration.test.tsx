// @vitest-environment jsdom
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * The one dialog behind both annotation-queue entry points.
 * Spec: specs/traces-v2/annotation-queue-actions.feature
 */

// Hoisted: AddParticipants imports `~/utils/api` transitively, so these mock
// fns must exist before the hoisted mock factories run.
const {
  mockMutate,
  mockOpenDrawer,
  mockToastCreate,
  mockPendingInvalidate,
  mockAssignedInvalidate,
  mockQueueCountsInvalidate,
} = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockOpenDrawer: vi.fn(),
  mockToastCreate: vi.fn(),
  mockPendingInvalidate: vi.fn(),
  mockAssignedInvalidate: vi.fn(),
  mockQueueCountsInvalidate: vi.fn(),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: mockOpenDrawer, drawerOpen: () => false }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme" },
    organization: { id: "org-1" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: mockToastCreate },
  Toaster: () => null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    annotation: {
      createQueueItem: {
        useMutation: () => ({ mutate: mockMutate, isLoading: false }),
      },
      getQueues: {
        useQuery: () => ({
          data: [{ id: "q1", name: "Weekly review" }],
          isLoading: false,
        }),
      },
    },
    organization: {
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({
          data: {
            members: [{ user: { id: "u1", name: "Dana Scully", image: null } }],
          },
          isLoading: false,
        }),
      },
    },
    useUtils: () => ({
      annotation: {
        getPendingItemsCount: { invalidate: mockPendingInvalidate },
        getAssignedItemsCount: { invalidate: mockAssignedInvalidate },
        getQueueItemsCounts: { invalidate: mockQueueCountsInvalidate },
      },
    }),
  },
}));

import { AddToAnnotationQueueDialog } from "../AddToAnnotationQueueDialog";

const onClose = vi.fn();

const renderDialog = (traceIds = ["t1", "t2"], open = true) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AddToAnnotationQueueDialog
        open={open}
        onClose={onClose}
        traceIds={traceIds}
      />
    </ChakraProvider>,
  );

/**
 * Opens the participant picker and clicks the named option. Matched by role —
 * the select also keeps a hidden native <option> mirror of the same label, and
 * a teammate option carries its avatar initials in the accessible name.
 */
const pickParticipant = async (name: string | RegExp) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name }));
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("AddToAnnotationQueueDialog", () => {
  describe("given the dialog is closed", () => {
    it("leaves the picker unmounted, so it loads nothing", () => {
      renderDialog(["t1"], false);

      expect(screen.queryByText("Send to:")).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });
  });

  describe("given the dialog is open", () => {
    it("names the action and offers teammates and queues to send to", async () => {
      renderDialog();

      expect(
        await screen.findByText("Add to annotation queue"),
      ).toBeInTheDocument();
      expect(screen.getByText("Send to:")).toBeInTheDocument();
    });

    it("keeps the send action unavailable until someone is picked", async () => {
      renderDialog();

      expect(
        await screen.findByRole("button", { name: "Send" }),
      ).toBeDisabled();
    });
  });

  describe("when a teammate is picked and the send is confirmed", () => {
    it("queues every trace the dialog was opened with", async () => {
      const user = userEvent.setup();
      renderDialog(["t1", "t2"]);

      await pickParticipant(/Dana Scully/);
      await user.click(screen.getByRole("button", { name: "Send" }));

      await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
      expect(mockMutate.mock.calls[0]?.[0]).toEqual({
        projectId: "proj-1",
        traceIds: ["t1", "t2"],
        annotators: ["user-u1"],
      });
    });

    it("refreshes the queue counts, closes, and confirms with a way to the queues", async () => {
      const user = userEvent.setup();
      // Resolve the mutation straight away so the success path runs.
      mockMutate.mockImplementation(
        (_input: unknown, opts: { onSuccess: () => void }) => opts.onSuccess(),
      );
      renderDialog(["t1"]);

      await pickParticipant(/Dana Scully/);
      await user.click(screen.getByRole("button", { name: "Send" }));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(mockPendingInvalidate).toHaveBeenCalledTimes(1);
      expect(mockAssignedInvalidate).toHaveBeenCalledTimes(1);
      expect(mockQueueCountsInvalidate).toHaveBeenCalledTimes(1);
      expect(mockToastCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Trace added to annotation queue",
          type: "success",
        }),
      );
    });
  });

  describe("when an existing queue is picked", () => {
    it("queues the traces in that queue", async () => {
      const user = userEvent.setup();
      renderDialog(["t1"]);

      await pickParticipant("Weekly review");
      await user.click(screen.getByRole("button", { name: "Send" }));

      await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
      expect(mockMutate.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ annotators: ["queue-q1"] }),
      );
    });
  });

  describe("when the user chooses to add a new queue", () => {
    it("opens the new-queue drawer without closing the dialog", async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.click(screen.getByRole("combobox"));
      await user.click(
        await screen.findByRole("button", { name: /Add New Queue/ }),
      );

      expect(mockOpenDrawer).toHaveBeenCalledWith(
        "addAnnotationQueue",
        undefined,
      );
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
