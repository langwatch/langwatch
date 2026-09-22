/**
 * @vitest-environment jsdom
 *
 * Stepping to the next queue item is a fresh read of a whole trace, so there is
 * a gap between asking for an item and having it. What the page shows in that
 * gap is the item the reviewer has just left, and anything that acts on it then
 * acts on the wrong item — so the gap has to be visible to the page, not merely
 * survived.
 *
 * The tRPC boundary is the only thing stood in for here: keeping the previous
 * item is react-query's own behaviour, and mocking that out would leave the
 * behaviour under test unexercised.
 */
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAnnotationQueueWalk } from "../useAnnotationQueueWalk";

const mocks = vi.hoisted(() => ({
  /** Answers one step read, so a read can also be held open indefinitely. */
  fetchStep: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    annotation: {
      getQueueWalkStep: {
        useQuery: (
          input: { projectId: string; queueItemId?: string },
          options: Record<string, unknown>,
        ) =>
          useQuery({
            queryKey: ["getQueueWalkStep", input],
            queryFn: () => mocks.fetchStep(input.queueItemId),
            ...options,
          }),
      },
    },
  },
}));

vi.mock("../useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

/** The shape the procedure answers with, for one item of a three-item queue. */
function stepFor(id: string, position: number) {
  return {
    item: { id, traceId: `trace-${id}`, trace: { trace_id: `trace-${id}` } },
    position,
    total: 3,
    previousItemId: position > 1 ? `item-${position - 1}` : null,
    nextItemId: position < 3 ? `item-${position + 1}` : null,
    queueFinished: false,
  };
}

function renderWalk(queueItemId: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderHook(
    (props: { queueItemId: string }) => useAnnotationQueueWalk(props),
    {
      initialProps: { queueItemId },
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    },
  );
}

beforeEach(() => {
  mocks.fetchStep.mockReset();
});

describe("given a reviewer reading an item of their queue", () => {
  describe("when they step to the next item and its read has not landed", () => {
    it("still serves the item they left, and says the step is stale", async () => {
      mocks.fetchStep.mockResolvedValueOnce(stepFor("item-1", 1));
      const { result, rerender } = renderWalk("item-1");

      await waitFor(() => expect(result.current.item?.id).toBe("item-1"));
      expect(result.current.stepIsStale).toBe(false);

      // The read for the item asked for never lands: this is the gap the
      // reviewer can click in, and it lasts as long as the trace takes.
      mocks.fetchStep.mockReturnValueOnce(new Promise(() => undefined));
      rerender({ queueItemId: "item-2" });

      await waitFor(() => expect(result.current.stepIsStale).toBe(true));
      // Which item is on screen is the whole point: whoever reads this hook is
      // holding the item the reviewer has left, not the one they asked for.
      expect(result.current.item?.id).toBe("item-1");
    });
  });

  describe("when the read for the item they asked for lands", () => {
    it("serves that item and stops calling the step stale", async () => {
      mocks.fetchStep.mockResolvedValueOnce(stepFor("item-1", 1));
      const { result, rerender } = renderWalk("item-1");

      await waitFor(() => expect(result.current.item?.id).toBe("item-1"));

      mocks.fetchStep.mockResolvedValueOnce(stepFor("item-2", 2));
      rerender({ queueItemId: "item-2" });

      await waitFor(() => expect(result.current.item?.id).toBe("item-2"));
      expect(result.current.stepIsStale).toBe(false);
      expect(result.current.position).toBe(2);
    });
  });
});
