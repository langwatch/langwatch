// @vitest-environment jsdom
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  mockToastCreate,
  mockPendingInvalidate,
  mockAssignedInvalidate,
  mockQueueCountsInvalidate,
} = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockToastCreate: vi.fn(),
  mockPendingInvalidate: vi.fn(),
  mockAssignedInvalidate: vi.fn(),
  mockQueueCountsInvalidate: vi.fn(),
}));

// The real drawer drags in the whole queue-management form; the seam under
// test is that it mounts inline (never via the drawer registry) and hands
// control back on close.
vi.mock("~/components/AddAnnotationQueueDrawer", () => ({
  AddAnnotationQueueDrawer: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="inline-queue-drawer">
      <button type="button" onClick={onClose}>
        close queue drawer
      </button>
    </div>
  ),
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
    it("mounts the new-queue drawer inline without closing the dialog", async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.click(screen.getByRole("combobox"));
      await user.click(
        await screen.findByRole("button", { name: /Add New Queue/ }),
      );

      expect(screen.getByTestId("inline-queue-drawer")).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("keeps the picks made before the sub-flow", async () => {
      const user = userEvent.setup();
      renderDialog();

      // The picker stays open after a pick, so Add New Queue is in reach.
      await pickParticipant(/Dana Scully/);
      await user.click(
        await screen.findByRole("button", { name: /Add New Queue/ }),
      );
      await user.click(
        screen.getByRole("button", { name: "close queue drawer" }),
      );

      expect(
        screen.queryByTestId("inline-queue-drawer"),
      ).not.toBeInTheDocument();
      // The dialog remounts with the earlier pick intact.
      expect(
        (await screen.findAllByText("Dana Scully")).length,
      ).toBeGreaterThan(0);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("when the send fails", () => {
    it("says so and keeps the dialog open for a retry", async () => {
      const user = userEvent.setup();
      mockMutate.mockImplementation(
        (
          _input: unknown,
          opts: { onError: (error: { message: string }) => void },
        ) => opts.onError({ message: "boom" }),
      );
      renderDialog(["t1"]);

      await pickParticipant(/Dana Scully/);
      await user.click(screen.getByRole("button", { name: "Send" }));

      await waitFor(() =>
        expect(mockToastCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Failed to add to annotation queue",
            type: "error",
          }),
        ),
      );
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("when several traces are sent", () => {
    it("confirms with a plural headline", async () => {
      const user = userEvent.setup();
      mockMutate.mockImplementation(
        (_input: unknown, opts: { onSuccess: () => void }) => opts.onSuccess(),
      );
      renderDialog(["t1", "t2", "t3"]);

      await pickParticipant(/Dana Scully/);
      await user.click(screen.getByRole("button", { name: "Send" }));

      await waitFor(() =>
        expect(mockToastCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "3 traces added to annotation queue",
            type: "success",
          }),
        ),
      );
    });
  });

  describe("when the dialog is closed without sending", () => {
    it("forgets the picks", async () => {
      const user = userEvent.setup();
      const view = renderDialog(["t1"]);

      await pickParticipant(/Dana Scully/);
      // Two "Close" buttons exist (dialog trigger + the pick chip's remove);
      // the dialog's carries the dialog data-scope.
      const dialogClose = document.querySelector(
        '[data-scope="dialog"][data-part="close-trigger"]',
      );
      await user.click(dialogClose as HTMLElement);
      await waitFor(() => expect(onClose).toHaveBeenCalled());

      view.rerender(
        <ChakraProvider value={defaultSystem}>
          <AddToAnnotationQueueDialog
            open={false}
            onClose={onClose}
            traceIds={["t1"]}
          />
        </ChakraProvider>,
      );
      view.rerender(
        <ChakraProvider value={defaultSystem}>
          <AddToAnnotationQueueDialog
            open={true}
            onClose={onClose}
            traceIds={["t1"]}
          />
        </ChakraProvider>,
      );

      expect(
        await screen.findByRole("button", { name: "Send" }),
      ).toBeDisabled();
      // The hidden native <option> mirror always lists every candidate; the
      // pick chip would live inside the combobox trigger.
      expect(
        within(screen.getByRole("combobox")).queryByText("Dana Scully"),
      ).not.toBeInTheDocument();
    });
  });
});
