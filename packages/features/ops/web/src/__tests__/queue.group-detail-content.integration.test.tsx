/**
 * @vitest-environment jsdom
 *
 * Renders the real GroupDetailContent via React Testing Library against an
 * actual ChakraProvider — the drawer body, minus the tRPC queries that feed
 * it. The vanished-group case is the one that mattered in practice: a group
 * finishes between the table refresh and the click, and the drawer used to
 * render a title and nothing else.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { GroupInfo } from "@langwatch/ops-contract";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { OpsQueueJob as JobEntry } from "@langwatch/ops-contract";
import { GroupDetailContent } from "../queue.group-detail-content";

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

function makeJob(overrides: Partial<JobEntry> = {}): JobEntry {
  return {
    jobId: "01J8ZAAAAAAAAAAAAAAAAAAAAA",
    score: NOW + 5_000,
    data: {
      traceId: "trace-payload-field",
      __jobType: "fold",
      __jobName: "span-map",
      __pipelineName: "spanStorage",
      __context: {
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        projectId: "project_LVYcVYGW1AJqvp2G8vcVd",
        userId: "user_9pQx2",
      },
    },
    payloadBytes: 2_048,
    envelope: { format: "j", version: 2, blobId: null },
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
      /** @scenario "A vanished group is reported, not rendered as an empty drawer" */
      it("says the group no longer exists instead of rendering an empty body", () => {
        renderContent({ detail: null, isLoading: false });
        const missing = screen.getByTestId("group-detail-missing");
        expect(missing.textContent).toContain("no longer exists");
      });
    });

    describe("when the detail query is still in flight", () => {
      it("shows a loading state, not the vanished message", () => {
        renderContent({ detail: null, isLoading: true });
        expect(screen.queryByTestId("group-detail-missing")).toBeNull();
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

    describe("when the operator opens its detail drawer", () => {
      /** @scenario "The drawer states the next attempt and the age of the last error" */
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

  describe("given a staged job carrying its type, name, and request context", () => {
    const job = makeJob();

    describe("when its card renders", () => {
      /** @scenario "A job reads structurally before it reads as JSON" */
      it("shows type, name, and context structurally, with JSON behind the toggle", () => {
        const { container } = renderContent({
          detail: makeGroup(),
          jobs: { jobs: [job], total: 1 },
        });
        expect(container.textContent).toContain("fold");
        expect(container.textContent).toContain("span-map");
        expect(container.textContent).toContain("Trace");
        expect(container.textContent).toContain("Project");
        expect(container.textContent).toContain("User");
        // The payload's own field is not on screen until the JSON toggle.
        expect(container.textContent).not.toContain("trace-payload-field");

        fireEvent.click(screen.getByRole("button", { name: "JSON" }));
        expect(container.textContent).toContain("trace-payload-field");
      });
    });
  });

  describe("given a staged job whose body lives in the payload store", () => {
    const offloaded = makeJob({
      payloadBytes: 48_128,
      envelope: { format: "s3", version: 2, blobId: "Ab12Cd34Ef56Gh78Ij90Kl" },
    });

    describe("when its card renders", () => {
      /** @scenario "A job offloaded to the payload store names its blob" */
      it("names the storage tier and the blob hash", () => {
        const { container } = renderContent({
          detail: makeGroup(),
          jobs: { jobs: [offloaded], total: 1 },
        });
        expect(container.textContent).toContain("s3 blob");
        expect(container.textContent).toContain("47.00KB");
      });
    });
  });

  describe("given a group holding more jobs than one page shows", () => {
    describe("when the jobs section renders", () => {
      /** @scenario "The jobs list pages rather than truncating" */
      it("states the on-screen slice and offers the next page", () => {
        const jobs = Array.from({ length: 20 }, (_, i) => makeJob({ jobId: `job-${i}` }));
        const { container } = renderContent({
          detail: makeGroup({ pendingJobs: 132 }),
          jobs: { jobs, total: 132 },
          jobsPage: 1,
          jobsPageSize: 20,
          onJobsPageChange: () => undefined,
        });
        expect(container.textContent).toContain("1–20 of 132");
        expect(screen.getByRole("button", { name: "Next jobs page" })).toBeTruthy();
      });
    });
  });

  describe("given a page filter", () => {
    it("narrows the visible jobs to matches within the page", () => {
      const jobs = [makeJob({ jobId: "job-alpha" }), makeJob({ jobId: "job-beta" })];
      const { container } = renderContent({
        detail: makeGroup(),
        jobs: { jobs, total: 2 },
        jobFilter: "beta",
        onJobFilterChange: () => undefined,
      });
      expect(container.textContent).toContain("job-beta");
      expect(container.textContent).not.toContain("job-alpha");
    });
  });
});
