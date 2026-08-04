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
    onSuccess?: () => void;
    onError?: (error: unknown) => void;
  } | null,
  sendFails: false,
  invalidatePending: vi.fn(),
  invalidateAssigned: vi.fn(),
  invalidateQueueCounts: vi.fn(),
  invalidateQueues: vi.fn(),
  toastCreate: vi.fn(),
  showErrorToast: vi.fn(),
  push: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
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
      createQueueItem: {
        useMutation: (options: {
          onSuccess?: () => void;
          onError?: (error: unknown) => void;
        }) => {
          mocks.mutationOptions = options;
          return { mutate: mocks.mutate, isLoading: false };
        },
      },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: mocks.toastCreate },
}));

vi.mock("~/features/errors", () => ({
  showErrorToast: mocks.showErrorToast,
}));

vi.mock("~/components/AddAnnotationQueueDrawer", () => ({
  AddAnnotationQueueDrawer: () => <div data-testid="new-queue-drawer" />,
}));

// The participants picker is a Chakra multi-select the dialog only composes.
// The stub keeps the contract the dialog depends on (annotators state in,
// `sendToQueue` out) without driving Ark's select in jsdom.
vi.mock("~/components/traces/AddParticipants", () => ({
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
      <button
        type="button"
        onClick={() =>
          setAnnotators([
            { id: "user-1", name: "Ana" },
            { id: "queue-1", name: "Support reviews" },
          ])
        }
      >
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

import { AddToAnnotationQueueDialog } from "../AddToAnnotationQueueDialog";

const onClose = vi.fn();

const renderDialog = (traceIds = ["t1", "t2", "t3"]) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AddToAnnotationQueueDialog
        open={true}
        onClose={onClose}
        traceIds={traceIds}
      />
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
  mocks.mutate.mockImplementation(() => {
    if (mocks.sendFails) {
      mocks.mutationOptions?.onError?.(new Error("boom"));
      return;
    }
    mocks.mutationOptions?.onSuccess?.();
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
        screen.getByText(
          "Send the selected traces to people or queues for annotation",
        ),
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

      /** @scenario "A successful send confirms and offers a way to open the queues" */
      it("confirms how many traces were sent and links to the queues", () => {
        renderDialog();

        pickAndSend();

        const toast = mocks.toastCreate.mock.calls[0]?.[0];
        expect(toast).toMatchObject({
          title: "Added to annotation queue",
          description: "3 traces sent for annotation",
          type: "success",
        });
        expect(toast.action.label).toBe("View queues");

        toast.action.onClick();
        expect(mocks.push).toHaveBeenCalledWith("/acme/annotations");
      });

      it("keeps the count readable for a single trace", () => {
        renderDialog(["only-one"]);

        pickAndSend();

        expect(mocks.toastCreate.mock.calls[0]?.[0]).toMatchObject({
          description: "1 trace sent for annotation",
        });
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

        expect(
          screen.queryByTestId("new-queue-drawer"),
        ).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Add new queue" }));

        expect(screen.getByTestId("new-queue-drawer")).toBeInTheDocument();
      });
    });
  });
});
