/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * The one dialog behind every "add to annotation queue" affordance (trace
 * table selection bar, trace drawer overflow menu).
 * Spec: specs/traces-v2/bulk-actions.feature.
 */

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutationOptions: null as {
    onSuccess?: (result: { created: number; skipped: number }) => void;
    onError?: (error: unknown) => void;
  } | null,
  sendFails: false,
  result: { created: 3, skipped: 0 },
  pickedAnnotators: [
    { id: "user-1", name: "Ana" },
    { id: "queue-1", name: "Support reviews" },
  ],
  sessionUserId: "me",
  invalidatePending: vi.fn(),
  invalidateAssigned: vi.fn(),
  invalidateQueueCounts: vi.fn(),
  invalidateQueues: vi.fn(),
  toastCreate: vi.fn(),
  showErrorToast: vi.fn(),
  push: vi.fn(),
}));

vi.mock("../../trace-api", () => ({
  api: {
    useUtils: () => ({
      annotation: {
        getPendingItemsCount: { invalidate: mocks.invalidatePending },
        getAssignedItemsCount: { invalidate: mocks.invalidateAssigned },
        getQueueItemsCounts: { invalidate: mocks.invalidateQueueCounts },
        getOptimizedAnnotationQueues: { invalidate: mocks.invalidateQueues },
      },
    }),
    annotation: {
      getQueues: {
        useQuery: () => ({
          data: [
            { id: "q1", name: "Support reviews", slug: "support-reviews" },
            { id: "q2", name: "Sales reviews", slug: "sales-reviews" },
          ],
        }),
      },
      createQueueItem: {
        useMutation: (options: {
          onSuccess?: (result: { created: number; skipped: number }) => void;
          onError?: (error: unknown) => void;
        }) => {
          mocks.mutationOptions = options;
          return { mutate: mocks.mutate, isLoading: false };
        },
      },
    },
  },
}));

vi.mock("../../../../behavior/auth-session", () => ({
  useSession: () => ({ data: { user: { id: mocks.sessionUserId } } }),
}));

vi.mock("../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
  }),
}));

vi.mock("../../../../behavior/next-router", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("../../../blocks/toaster", () => ({
  toaster: { create: mocks.toastCreate },
}));

vi.mock("../../errors", () => ({
  showErrorToast: mocks.showErrorToast,
}));

vi.mock("../../add-annotation-queue-drawer", () => ({
  AddAnnotationQueueDrawer: () => <div data-testid="new-queue-drawer" />,
}));

// The participants picker is a Chakra multi-select the dialog only composes.
// The stub keeps the contract the dialog depends on (annotators state in,
// `sendToQueue` out) without driving Ark's select in jsdom.
vi.mock("../../traces/add-participants", () => ({
  AddParticipants: ({
    annotators,
    setAnnotators,
    sendToQueue,
    isLoading,
    queueDrawerOpen,
  }: {
    annotators: { id: string; name: string }[];
    setAnnotators: (annotators: { id: string; name: string }[]) => void;
    sendToQueue?: () => void;
    isLoading?: boolean;
    queueDrawerOpen?: { onOpen: () => void };
  }) => (
    <div>
      <button type="button" onClick={() => setAnnotators(mocks.pickedAnnotators)}>
        Pick participants
      </button>
      <button type="button" onClick={() => queueDrawerOpen?.onOpen()}>
        Add new queue
      </button>
      <button
        type="button"
        disabled={annotators.length === 0 || !!isLoading}
        onClick={sendToQueue}
      >
        Send
      </button>
    </div>
  ),
}));

import { AddToAnnotationQueueDialog } from "../add-to-annotation-queue-dialog";

const onClose = vi.fn();

const renderDialog = (traceIds = ["t1", "t2", "t3"]) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AddToAnnotationQueueDialog open={true} onClose={onClose} traceIds={traceIds} />
    </ChakraProvider>,
  );

const pickAndSend = () => {
  fireEvent.click(screen.getByRole("button", { name: "Pick participants" }));
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
};

beforeEach(() => {
  mocks.sendFails = false;
  mocks.mutationOptions = null;
  mocks.mutate.mockReset();
  mocks.result = { created: 3, skipped: 0 };
  mocks.sessionUserId = "me";
  mocks.pickedAnnotators = [
    { id: "user-1", name: "Ana" },
    { id: "queue-1", name: "Support reviews" },
  ];
  mocks.mutate.mockImplementation(() => {
    if (mocks.sendFails) {
      mocks.mutationOptions?.onError?.(new Error("boom"));
      return;
    }
    mocks.mutationOptions?.onSuccess?.(mocks.result);
  });
  mocks.invalidatePending.mockClear();
  mocks.invalidateAssigned.mockClear();
  mocks.invalidateQueueCounts.mockClear();
  mocks.invalidateQueues.mockClear();
  mocks.toastCreate.mockClear();
  mocks.showErrorToast.mockClear();
  mocks.push.mockClear();
  onClose.mockClear();
});

afterEach(cleanup);

describe("AddToAnnotationQueueDialog", () => {
  describe("given the dialog is open for selected traces", () => {
    /** @scenario "The dialog says where the traces are going" */
    it("names the action and who the traces go to", () => {
      renderDialog();

      expect(screen.getByText("Add to annotation queue")).toBeInTheDocument();
      expect(
        screen.getByText("Send the selected traces to people or queues for annotation"),
      ).toBeInTheDocument();
    });

    describe("when the user picks participants and sends", () => {
      /** @scenario "Sending queues every selected trace for the chosen participants" */
      it("queues every selected trace for every chosen participant", () => {
        renderDialog();

        pickAndSend();

        expect(mocks.mutate).toHaveBeenCalledWith({
          projectId: "project-1",
          traceIds: ["t1", "t2", "t3"],
          annotators: ["user-1", "queue-1"],
        });
      });
    });

    describe("when the send succeeds", () => {
      /** @scenario "A successful send refreshes the annotation counts" */
      it("refreshes the counts and the queue listing, then closes", () => {
        renderDialog();

        pickAndSend();

        expect(mocks.invalidatePending).toHaveBeenCalledTimes(1);
        expect(mocks.invalidateAssigned).toHaveBeenCalledTimes(1);
        expect(mocks.invalidateQueueCounts).toHaveBeenCalledTimes(1);
        expect(mocks.invalidateQueues).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
      });

      /** @scenario "A successful send counts what actually became queue items" */
      it("confirms how many traces became queue items", () => {
        renderDialog();

        pickAndSend();

        expect(mocks.toastCreate.mock.calls[0]?.[0]).toMatchObject({
          title: "Added to annotation queue",
          description: "3 traces sent for annotation",
          type: "success",
        });
      });

      /** @scenario "A send that dropped traces says how many were skipped" */
      it("says how many were skipped and why", () => {
        mocks.result = { created: 2, skipped: 1 };
        renderDialog();

        pickAndSend();

        expect(mocks.toastCreate.mock.calls[0]?.[0]).toMatchObject({
          description:
            "2 traces sent for annotation. 1 skipped because its trace no longer exists",
        });
      });

      it("keeps the count readable for a single trace", () => {
        mocks.result = { created: 1, skipped: 0 };
        renderDialog(["only-one"]);

        pickAndSend();

        expect(mocks.toastCreate.mock.calls[0]?.[0]).toMatchObject({
          description: "1 trace sent for annotation",
        });
      });

      /** @scenario "Sending to several participants offers to open the queues" */
      it("offers the queue listing when the traces went several ways", () => {
        renderDialog();

        pickAndSend();

        const toast = mocks.toastCreate.mock.calls[0]?.[0];
        expect(toast.action.label).toBe("View queues");

        toast.action.onClick();
        expect(mocks.push).toHaveBeenCalledWith("/acme/annotations");
      });

      /** @scenario "Sending to a single queue offers to open that queue" */
      it("offers that queue when it was the only participant", () => {
        mocks.pickedAnnotators = [{ id: "queue-q1", name: "Support reviews" }];
        renderDialog();

        pickAndSend();

        const toast = mocks.toastCreate.mock.calls[0]?.[0];
        expect(toast.action.label).toBe("View queue");

        toast.action.onClick();
        expect(mocks.push).toHaveBeenCalledWith("/acme/annotations/support-reviews");
      });

      /** @scenario "Sending to yourself alone offers to open your inbox" */
      it("offers the sender's own queue when they sent to themselves", () => {
        mocks.pickedAnnotators = [{ id: "user-me", name: "Me" }];
        renderDialog();

        pickAndSend();

        const toast = mocks.toastCreate.mock.calls[0]?.[0];
        expect(toast.action.label).toBe("View inbox");

        toast.action.onClick();
        expect(mocks.push).toHaveBeenCalledWith("/acme/annotations/me");
      });

      it("offers the queue listing when the traces went to a teammate", () => {
        mocks.pickedAnnotators = [{ id: "user-other", name: "Ana" }];
        renderDialog();

        pickAndSend();

        expect(mocks.toastCreate.mock.calls[0]?.[0].action.label).toBe("View queues");
      });
    });

    describe("when the send fails", () => {
      /** @scenario "A failed send says the traces were not queued" */
      it("reports the failure and leaves the counts alone", () => {
        mocks.sendFails = true;
        renderDialog();

        pickAndSend();

        expect(mocks.showErrorToast).toHaveBeenCalledWith(
          expect.objectContaining({
            fallbackTitle: "Couldn't add to annotation queue",
          }),
        );
        expect(mocks.invalidatePending).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
      });
    });

    describe("when the user wants a queue that does not exist yet", () => {
      /** @scenario "A queue can be created without leaving the dialog" */
      it("opens the new queue drawer from inside the dialog", () => {
        renderDialog();

        expect(screen.queryByTestId("new-queue-drawer")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Add new queue" }));

        expect(screen.getByTestId("new-queue-drawer")).toBeInTheDocument();
      });
    });
  });
});
