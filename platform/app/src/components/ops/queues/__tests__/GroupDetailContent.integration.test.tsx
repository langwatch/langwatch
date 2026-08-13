/**
 * @vitest-environment jsdom
 *
 * Renders the real GroupDetailContent via React Testing Library against an
 * actual ChakraProvider — the dialog body, minus the tRPC queries that feed
 * it. The vanished-group case is the one that mattered in practice: a group
 * finishes between the table refresh and the click, and the dialog used to
 * render a title and nothing else.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GroupInfo } from "~/server/app-layer/ops/types";
import { GroupDetailContent } from "../GroupDetailDialog";

const NOW = 1_755_100_000_000;

function makeGroup(overrides: Partial<GroupInfo> = {}): GroupInfo {
  return {
    groupId: "project_a/map/spanStorage/span-map:1",
    pendingJobs: 1,
    score: NOW - 1_000,
    hasActiveJob: false,
    activeJobId: null,
    isBlocked: false,
    oldestJobMs: NOW - 60_000,
    newestJobMs: NOW - 5_000,
    isStaleBlock: false,
    pipelineName: "spanStorage",
    jobType: "map",
    jobName: "span-map",
    errorMessage: null,
    errorStack: null,
    errorTimestamp: null,
    retryCount: null,
    activeKeyTtlSec: null,
    processingDurationMs: null,
    ...overrides,
  };
}

function renderContent(
  props: Partial<React.ComponentProps<typeof GroupDetailContent>> = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <GroupDetailContent
        detail={null}
        isLoading={false}
        jobs={null}
        jobsLoading={false}
        now={NOW}
        {...props}
      />
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("GroupDetailContent", () => {
  describe("given the group vanished between the table refresh and the click", () => {
    describe("when the detail query finishes with nothing", () => {
      /** @scenario "A vanished group is reported, not rendered as an empty dialog" */
      it("says the group no longer exists instead of rendering an empty body", () => {
        renderContent({ detail: null, isLoading: false });
        const missing = screen.getByTestId("group-detail-missing");
        expect(missing.textContent).toContain("no longer exists");
      });
    });

    describe("when the detail query is still in flight", () => {
      it("shows a loading state, not the vanished message", () => {
        renderContent({ detail: null, isLoading: true });
        expect(
          screen.queryByTestId("group-detail-missing"),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given a retrying group with a recorded error", () => {
    const retrying = makeGroup({
      retryCount: 2,
      errorMessage: "connect ECONNREFUSED 10.0.0.7:6379",
      errorTimestamp: NOW - 8_000,
      score: NOW + 30_000,
      hasActiveJob: false,
      pendingJobs: 1,
    });

    describe("when the operator opens its detail dialog", () => {
      /** @scenario "The dialog states the next attempt and the age of the last error" */
      it("shows the attempt count, the next attempt countdown, and the error age", () => {
        const { container } = renderContent({ detail: retrying });
        expect(container.textContent).toContain("Attempts");
        expect(container.textContent).toContain("2");
        expect(container.textContent).toContain("in 30s");
        expect(container.textContent).toContain("8s ago");
        expect(container.textContent).toContain("ECONNREFUSED");
      });

      it("labels it as retrying", () => {
        const { container } = renderContent({ detail: retrying });
        expect(container.textContent).toContain("Retrying");
      });
    });
  });

  describe("given a healthy queued group", () => {
    it("says when it next runs without inventing an error section", () => {
      const { container } = renderContent({
        detail: makeGroup({ pendingJobs: 3, score: NOW - 500 }),
      });
      expect(container.textContent).toContain("Next run");
      expect(container.textContent).toContain("now");
      expect(container.textContent).not.toContain("Last error");
    });
  });
});
