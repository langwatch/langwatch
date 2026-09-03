/**
 * @vitest-environment jsdom
 *
 * A queue nobody can see yet is a queue nobody can send to, so saving one has
 * to refresh every list and badge that reads queues.
 * Spec: specs/traces-v2/bulk-actions.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  invalidate: {
    optimizedQueues: vi.fn(),
    queueBySlugOrId: vi.fn(),
    queues: vi.fn(),
    queueItemsCounts: vi.fn(),
    pendingItemsCount: vi.fn(),
    assignedItemsCount: vi.fn(),
  },
  toastCreate: vi.fn(),
  // Stable references: the drawer hydrates its local state from `queue.data`
  // in an effect keyed on that object, so a fresh literal per render would
  // loop forever.
  queue: {
    id: "q1",
    name: "Support reviews",
    description: "",
    members: [{ user: { id: "user-1", name: "Ana" } }],
    AnnotationQueueScores: [
      { annotationScore: { id: "score-1", name: "Helpfulness" } },
    ],
  },
  scores: [{ id: "score-1", name: "Helpfulness" }],
  organizationMembers: { members: [{ user: { id: "user-1", name: "Ana" } }] },
}));

vi.mock("../trace-api", () => ({
  api: {
    useUtils: () => ({
      annotation: {
        getOptimizedAnnotationQueues: {
          invalidate: mocks.invalidate.optimizedQueues,
        },
        getQueueBySlugOrId: { invalidate: mocks.invalidate.queueBySlugOrId },
        getQueues: { invalidate: mocks.invalidate.queues },
        getQueueItemsCounts: { invalidate: mocks.invalidate.queueItemsCounts },
        getPendingItemsCount: {
          invalidate: mocks.invalidate.pendingItemsCount,
        },
        getAssignedItemsCount: {
          invalidate: mocks.invalidate.assignedItemsCount,
        },
      },
    }),
    annotation: {
      createOrUpdateQueue: {
        useMutation: () => ({ mutate: mocks.mutate, isPending: false }),
      },
      getQueueBySlugOrId: {
        useQuery: () => ({ data: mocks.queue }),
      },
    },
    annotationScore: {
      getAllActive: {
        useQuery: () => ({ data: mocks.scores }),
      },
    },
    organization: {
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({ data: mocks.organizationMembers }),
      },
    },
  },
}));
vi.mock("../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p1", slug: "acme" },
    organization: { id: "org-1" },
  }),
}));
vi.mock("../../../behavior/use-drawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn() }),
}));
vi.mock("@langwatch/design-system/toaster", () => ({
  toaster: { create: mocks.toastCreate },
}));
vi.mock("../errors", () => ({
  applyHandledErrorToForm: () => false,
  FormServerError: () => null,
  showErrorToast: vi.fn(),
}));
vi.mock("../annotations/add-or-edit-annotation-score", () => ({
  AddOrEditAnnotationScore: () => null,
}));

import { AddAnnotationQueueDrawer } from "../add-annotation-queue-drawer";

const renderDrawer = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AddAnnotationQueueDrawer open={true} queueId="q1" onClose={vi.fn()} />
    </ChakraProvider>,
  );

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.toastCreate.mockClear();
  for (const spy of Object.values(mocks.invalidate)) spy.mockClear();
});
afterEach(cleanup);

describe("AddAnnotationQueueDrawer", () => {
  describe("given the queue is saved", () => {
    /** @scenario "A queue created here shows up everywhere without a refresh" */
    it("refreshes the picker, the sidebar and the counts", async () => {
      renderDrawer();

      fireEvent.submit(screen.getByRole("button", { name: "Save" }));

      await vi.waitFor(() => expect(mocks.mutate).toHaveBeenCalled());
      const onSuccess = mocks.mutate.mock.calls[0]?.[1]?.onSuccess;
      onSuccess?.({ name: "Support reviews" });

      expect(mocks.invalidate.optimizedQueues).toHaveBeenCalledTimes(1);
      expect(mocks.invalidate.queueBySlugOrId).toHaveBeenCalledTimes(1);
      expect(mocks.invalidate.queues).toHaveBeenCalledTimes(1);
      expect(mocks.invalidate.queueItemsCounts).toHaveBeenCalledTimes(1);
      expect(mocks.invalidate.pendingItemsCount).toHaveBeenCalledTimes(1);
      expect(mocks.invalidate.assignedItemsCount).toHaveBeenCalledTimes(1);
    });
  });
});
