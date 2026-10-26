/**
 * @vitest-environment node
 * `topics.triggerTopicClustering` over the real runtime and the real trigger
 * service, with the clustering status and request faked.
 * Spec: modules/topic/specs/topic-manual-trigger.feature.
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { HandledError } from "@langwatch/handled-error";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import type {
  TopicApi,
  TopicClusteringRunHistoryEntry,
  TopicClusteringStatus,
} from "@langwatch/topic-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { TopicClusteringTriggerService } from "../../services/topic-clustering-trigger.service.ts";
import { topicTrpcTransport, type TopicBrowserApi } from "../topic.trpc.ts";

type TopicTrpcTestContext = { actor: { id: string } };

const ACTOR_ID = "test-user-id";

/** The refusal a deployment raises when it composed no clustering scheduler. */
class NoClusteringSchedulerError extends HandledError {
  static readonly code = "service_unavailable" as const;
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "This deployment has no topic-clustering scheduler.", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "NoClusteringSchedulerError";
  }
}

function statusOf(isRunInFlight: boolean): TopicClusteringStatus {
  return { isRunInFlight } as TopicClusteringStatus;
}

function mount({
  isRunInFlight = false,
  requestClustering = async () => undefined,
  permits = () => true,
  getClusteringRunHistory = async () => [],
  getClusteringRunHistoryPage = async () => ({ outcome: "cursor_expired" }),
}: {
  isRunInFlight?: boolean;
  requestClustering?: TopicApi["requestClustering"];
  permits?: (permission: string) => boolean;
  getClusteringRunHistory?: TopicApi["getClusteringRunHistory"];
  getClusteringRunHistoryPage?: TopicApi["getClusteringRunHistoryPage"];
} = {}) {
  const reportFailure = vi.fn();
  const request = vi.fn(requestClustering);
  const application = createApiFixture<TopicApi>(
    {
      getClusteringStatus: async () => statusOf(isRunInFlight),
      requestClustering: request,
      getClusteringRunHistory,
      getClusteringRunHistoryPage,
    },
    "TopicApi",
  );
  const trigger = TopicClusteringTriggerService.create({
    clustering: application,
    reportFailure,
    now: () => 1_000,
  });
  const browser: TopicBrowserApi = {
    topics: () => application,
    triggerTopicClustering: (input) => trigger.trigger(input),
    getTopicCounts: async () => ({
      topicCounts: [{ id: "t1", name: "Billing", count: 2 }],
      subtopicCounts: [],
    }),
  };
  const trpc = initTRPC.context<TopicTrpcTestContext>().create();
  const router = createTrpcRuntime<TopicTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TopicTrpcTestContext>({ permits }),
  }).mount(topicTrpcTransport, () => browser);

  return { request, reportFailure, caller: router.createCaller({ actor: { id: ACTOR_ID } }) };
}

describe("topics.triggerTopicClustering", () => {
  describe("when a run is already in flight", () => {
    /** @scenario "A manual clustering request while a run is in flight says so" */
    it("says a run is already going rather than reporting a start that did not happen", async () => {
      const { caller, request } = mount({ isRunInFlight: true });

      await expect(caller.triggerTopicClustering({ projectId: "project_123" })).resolves.toEqual({
        started: false,
        reason: "already_running",
      });
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe("when no run is in flight", () => {
    /** @scenario "A manual clustering request is attributed to the member who asked" */
    it("sends the manual request attributed to the caller", async () => {
      const { caller, request } = mount();

      await expect(caller.triggerTopicClustering({ projectId: "project_123" })).resolves.toEqual({
        started: true,
      });
      expect(request).toHaveBeenCalledWith({
        projectId: "project_123",
        occurredAt: 1_000,
        trigger: "manual",
        requestedByUserId: ACTOR_ID,
      });
    });
  });

  describe("when the deployment composed no clustering scheduler", () => {
    /** @scenario "A deployment without a clustering scheduler refuses by name" */
    it("re-raises the named refusal rather than degrading it", async () => {
      const { caller, reportFailure } = mount({
        requestClustering: async () => {
          throw new NoClusteringSchedulerError();
        },
      });

      await expect(
        caller.triggerTopicClustering({ projectId: "project_123" }),
      ).rejects.toMatchObject({ cause: { code: "service_unavailable", httpStatus: 503 } });
      expect(reportFailure).toHaveBeenCalledWith(expect.any(Error), { projectId: "project_123" });
    });
  });

  describe("when the request fails inside the platform", () => {
    /** @scenario "A clustering run that fails inside the platform degrades to an unknown failure" */
    it("reports the failure and raises an unhandled error", async () => {
      const { caller, reportFailure } = mount({
        requestClustering: async () => {
          throw new Error("projection host db-7 unreachable");
        },
      });

      await expect(
        caller.triggerTopicClustering({ projectId: "project_123" }),
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to trigger topic clustering",
      });
      expect(reportFailure).toHaveBeenCalledWith(expect.any(Error), { projectId: "project_123" });
    });
  });

  describe("when the clustering scheduler cannot be reached", () => {
    /** @scenario "A clustering request whose scheduler cannot be reached is reported, not raised" */
    it("reports the failure for the project and answers an unknown failure", async () => {
      const { caller, reportFailure } = mount({
        requestClustering: async () => {
          throw new Error("connect ECONNREFUSED clustering-scheduler:443");
        },
      });

      const refusal = caller.triggerTopicClustering({ projectId: "project_123" });

      await expect(refusal).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
      await expect(refusal).rejects.not.toHaveProperty("cause.code");
      expect(reportFailure).toHaveBeenCalledWith(expect.any(Error), { projectId: "project_123" });
    });
  });
});

describe("topics.getTopicCounts", () => {
  describe("when a member asks under a trace filter", () => {
    /** @scenario "name the trace counts for the topic filter" */
    it("answers the named counts the topic application read", async () => {
      const { caller } = mount();

      await expect(
        caller.getTopicCounts({ projectId: "project_123", startDate: 1, endDate: 2 }),
      ).resolves.toEqual({
        topicCounts: [{ id: "t1", name: "Billing", count: 2 }],
        subtopicCounts: [],
      });
    });
  });
});

const finishedRun: TopicClusteringRunHistoryEntry = {
  runId: "run_1",
  trigger: "manual",
  startedAt: 1,
  finishedAt: 2,
  outcome: "completed",
  mode: "batch",
  skippedReason: null,
  errorCode: null,
  isErrorUserActionable: false,
  tracesProcessed: 1,
  topicsCount: 1,
  subtopicsCount: 0,
  pages: 1,
};

describe("topics.getClusteringRunHistoryPage", () => {
  describe("when the caller lacks the project view permission", () => {
    /** @scenario "Reading the run history by page is a project view, like reading it whole" */
    it("refuses them and reads no history", async () => {
      const getClusteringRunHistoryPage = vi.fn(async () => ({
        outcome: "cursor_expired" as const,
      }));
      const { caller } = mount({
        permits: (permission) => permission !== "project:view",
        getClusteringRunHistoryPage,
      });

      await expect(
        caller.getClusteringRunHistoryPage({ projectId: "project_123" }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(getClusteringRunHistoryPage).not.toHaveBeenCalled();
    });
  });

  describe("when a member who may view asks", () => {
    it("hands the parsed cursor and the default limit on and returns the page", async () => {
      const asked: Parameters<TopicApi["getClusteringRunHistoryPage"]>[0][] = [];
      const { caller } = mount({
        getClusteringRunHistoryPage: async (input) => {
          asked.push(input);

          return { outcome: "page", entries: [finishedRun], hasMore: true, nextCursor: "run_1" };
        },
      });

      await expect(
        caller.getClusteringRunHistoryPage({ projectId: "project_123", cursor: "run_2" }),
      ).resolves.toEqual({
        outcome: "page",
        entries: [finishedRun],
        hasMore: true,
        nextCursor: "run_1",
      });
      expect(asked).toEqual([{ projectId: "project_123", cursor: "run_2", limit: 20 }]);
    });

    it("refuses a limit past the retained history before the application is asked", async () => {
      const getClusteringRunHistoryPage = vi.fn(async () => ({
        outcome: "cursor_expired" as const,
      }));
      const { caller } = mount({ getClusteringRunHistoryPage });

      await expect(
        caller.getClusteringRunHistoryPage({ projectId: "project_123", limit: 500 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(getClusteringRunHistoryPage).not.toHaveBeenCalled();
    });

    /** @scenario "The whole-history read keeps answering the array it always did" */
    it("keeps answering the whole history as an array on the old procedure", async () => {
      const { caller } = mount({ getClusteringRunHistory: async () => [finishedRun] });

      await expect(caller.getClusteringRunHistory({ projectId: "project_123" })).resolves.toEqual([
        finishedRun,
      ]);
    });
  });
});
