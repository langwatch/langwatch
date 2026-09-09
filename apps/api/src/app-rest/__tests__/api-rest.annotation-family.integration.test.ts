import { AnnotationNotFoundError, type AnnotationApi } from "@langwatch/annotation-contract";
import { describe, expect, it, vi } from "vitest";

import { mountRestFamily } from "./support/rest-family.harness.ts";

describe("the annotation REST family", () => {
  /** @scenario "A REST request is parsed before its credential is resolved" */
  it("parses a request before resolving its credential, then reads with the credential project", async () => {
    const credential = vi.fn(async () => successfulCredential());
    const list = vi.fn(async () => []);
    const api = mount({ annotations: annotationApi({ list }), credential });

    const invalid = await api.get("/api/annotations?anchor=unknown");
    expect(invalid.status).toBe(400);
    expect(credential).not.toHaveBeenCalled();

    const response = await api.get("/api/annotations?anchor=trace");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [] });
    expect(credential).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "annotations:view" }),
    );
    expect(list).toHaveBeenCalledWith({ projectId: "project-1", anchor: "trace" });
  });

  /** @scenario "A REST request is parsed before its credential is resolved" */
  it("keeps the legacy malformed-write response and does not resolve a credential", async () => {
    const credential = vi.fn(async () => successfulCredential());
    const api = mount({ annotations: annotationApi({}), credential });

    const response = await api.post("/api/annotations/trace/trace-1", { isThumbsUp: true });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      message: "[comment] is required in the request body and must be a string.",
    });
    expect(credential).not.toHaveBeenCalled();
  });

  /** @scenario "A REST request is parsed before its credential is resolved" */
  it("returns 204 for a successful deletion and marks the credential used afterwards", async () => {
    const markUsed = vi.fn();
    const credential = vi.fn(async () => successfulCredential(markUsed));
    const remove = vi.fn(async () => annotationRow());
    const api = mount({ annotations: annotationApi({ delete: remove }), credential });

    const response = await api.delete("/api/annotations/annotation-1");

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(remove).toHaveBeenCalledWith({ id: "annotation-1", projectId: "project-1" });
    expect(markUsed).toHaveBeenCalledTimes(1);
    expect(credential).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "annotations:manage" }),
    );
  });

  it("keeps not-found and store-failure bodies without marking a failed credential used", async () => {
    const markUsed = vi.fn();
    const api = mount({
      annotations: annotationApi({
        getById: vi.fn(async () => {
          throw new AnnotationNotFoundError("annotation-1");
        }),
      }),
      credential: vi.fn(async () => successfulCredential(markUsed)),
    });

    const missing = await api.get("/api/annotations/annotation-1");
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      status: "error",
      message: "Annotation not found.",
    });
    expect(markUsed).not.toHaveBeenCalled();

    const failing = mount({
      annotations: annotationApi({
        list: vi.fn(async () => {
          throw new Error("database details must not reach the wire");
        }),
      }),
      credential: vi.fn(async () => successfulCredential(markUsed)),
    });
    const failure = await failing.get("/api/annotations");
    expect(failure.status).toBe(500);
    await expect(failure.json()).resolves.toEqual({
      status: "error",
      message: "Internal server error.",
    });
    expect(markUsed).not.toHaveBeenCalled();
  });
});

function mount(options: { annotations: AnnotationApi; credential: ReturnType<typeof vi.fn> }) {
  return mountRestFamily({
    services: { annotations: () => options.annotations },
    processPorts: { handlerManagedCredential: options.credential },
  });
}

function successfulCredential(markUsed = vi.fn()) {
  return {
    ok: true as const,
    project: { id: "project-1" },
    resolved: { type: "legacyProjectKey" as const, project: { id: "project-1" } },
    markUsed,
  };
}

function annotationApi(overrides: Partial<AnnotationApi>): AnnotationApi {
  return new AnnotationHttpTestApp(overrides);
}

class AnnotationHttpTestApp implements AnnotationApi {
  constructor(private readonly overrides: Partial<AnnotationApi>) {}

  create: AnnotationApi["create"] = (input) => this.call("create", input);
  createUnattributed: AnnotationApi["createUnattributed"] = (input) =>
    this.call("createUnattributed", input);
  createReview: AnnotationApi["createReview"] = (input) => this.call("createReview", input);
  update: AnnotationApi["update"] = (input) => this.call("update", input);
  updateReview: AnnotationApi["updateReview"] = (input) => this.call("updateReview", input);
  delete: AnnotationApi["delete"] = (input) => this.call("delete", input);
  deleteReview: AnnotationApi["deleteReview"] = (input) => this.call("deleteReview", input);
  getById: AnnotationApi["getById"] = (input) => this.call("getById", input);
  list: AnnotationApi["list"] = (input) => this.call("list", input);
  listWithFullUsers: AnnotationApi["listWithFullUsers"] = (input) =>
    this.call("listWithFullUsers", input);
  listWithUserSummaries: AnnotationApi["listWithUserSummaries"] = (input) =>
    this.call("listWithUserSummaries", input);
  listReviewQueueItems: AnnotationApi["listReviewQueueItems"] = (input) =>
    this.call("listReviewQueueItems", input);
  listOptimizedQueues: AnnotationApi["listOptimizedQueues"] = (input) =>
    this.call("listOptimizedQueues", input);
  listForProjection: AnnotationApi["listForProjection"] = (input) =>
    this.call("listForProjection", input);
  listScoreNames: AnnotationApi["listScoreNames"] = (input) => this.call("listScoreNames", input);
  upsertScore: AnnotationApi["upsertScore"] = (input) => this.call("upsertScore", input);
  listScores: AnnotationApi["listScores"] = (input) => this.call("listScores", input);
  getScore: AnnotationApi["getScore"] = (input) => this.call("getScore", input);
  toggleScore: AnnotationApi["toggleScore"] = (input) => this.call("toggleScore", input);
  deleteScore: AnnotationApi["deleteScore"] = (input) => this.call("deleteScore", input);
  createQueueItems: AnnotationApi["createQueueItems"] = (input) =>
    this.call("createQueueItems", input);
  getProjectOrganizationId: AnnotationApi["getProjectOrganizationId"] = (input) =>
    this.call("getProjectOrganizationId", input);
  assertQueueConfigurationReferences: AnnotationApi["assertQueueConfigurationReferences"] = (
    input,
  ) => this.call("assertQueueConfigurationReferences", input);
  assertAnnotatorReferences: AnnotationApi["assertAnnotatorReferences"] = (input) =>
    this.call("assertAnnotatorReferences", input);
  configure: AnnotationApi["configure"] = (input) => this.call("configure", input);
  listQueues: AnnotationApi["listQueues"] = (input) => this.call("listQueues", input);
  getQueue: AnnotationApi["getQueue"] = (input) => this.call("getQueue", input);
  tryGetQueue: AnnotationApi["tryGetQueue"] = (input) => this.call("tryGetQueue", input);
  listQueueItems: AnnotationApi["listQueueItems"] = (input) => this.call("listQueueItems", input);
  countPendingItems: AnnotationApi["countPendingItems"] = (input) =>
    this.call("countPendingItems", input);
  countAssignedItems: AnnotationApi["countAssignedItems"] = (input) =>
    this.call("countAssignedItems", input);
  listMemberQueuePendingCounts: AnnotationApi["listMemberQueuePendingCounts"] = (input) =>
    this.call("listMemberQueuePendingCounts", input);
  deleteQueueItems: AnnotationApi["deleteQueueItems"] = (input) =>
    this.call("deleteQueueItems", input);
  markQueueItemDone: AnnotationApi["markQueueItemDone"] = (input) =>
    this.call("markQueueItemDone", input);
  listQueueItemsPage: AnnotationApi["listQueueItemsPage"] = (input) =>
    this.call("listQueueItemsPage", input);
  listQueuesWithItems: AnnotationApi["listQueuesWithItems"] = (input) =>
    this.call("listQueuesWithItems", input);
  queueTraces: AnnotationApi["queueTraces"] = (input) => this.call("queueTraces", input);

  private call<Method extends keyof AnnotationApi>(
    method: Method,
    input: Parameters<AnnotationApi[Method]>[0],
  ): ReturnType<AnnotationApi[Method]> {
    const implementation = this.overrides[method];
    if (implementation) return implementation(input);
    return Promise.reject(new Error(`${method} was not configured`));
  }
}

function annotationRow() {
  return {
    id: "annotation-1",
    projectId: "project-1",
    traceId: "trace-1",
    comment: "looks right",
    isThumbsUp: true,
    userId: null,
    email: null,
    scoreOptions: {},
    expectedOutput: null,
    anchorKind: null,
    anchorId: null,
    anchorPath: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  };
}
