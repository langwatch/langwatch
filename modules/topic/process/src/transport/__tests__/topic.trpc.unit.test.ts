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
import type { TopicApi, TopicClusteringStatus } from "@langwatch/topic-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { TopicClusteringTriggerService } from "../../services/topic-clustering-trigger.service.ts";
import { topicTrpcTransport, type TopicBrowserApi } from "../topic.trpc.ts";

type TopicTrpcTestContext = { actor: { id: string } };

const ACTOR_ID = "test-user-id";

/** The refusal a deployment raises when it composed no clustering scheduler. */
class NoClusteringSchedulerError extends HandledError {
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
}: {
  isRunInFlight?: boolean;
  requestClustering?: TopicApi["requestClustering"];
} = {}) {
  const reportFailure = vi.fn();
  const request = vi.fn(requestClustering);
  const application = createApiFixture<TopicApi>(
    { getClusteringStatus: async () => statusOf(isRunInFlight), requestClustering: request },
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
  };
  const trpc = initTRPC.context<TopicTrpcTestContext>().create();
  const router = createTrpcRuntime<TopicTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TopicTrpcTestContext>({ permits: () => true }),
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
