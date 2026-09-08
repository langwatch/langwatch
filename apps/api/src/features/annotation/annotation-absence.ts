/**
 * The annotation surfaces on a process that composed no database or no project
 * directory, and the refusal every one of them answers with.
 *
 * Kept apart from the installation so the refusing shape is reachable without
 * the container, the adapters or the feature's own graph.
 */
import type { AnnotationApi } from "@langwatch/annotation-contract";
import { HandledError } from "@langwatch/handled-error";

import {
  createAnnotationScoreTrpcRouter,
  createAnnotationTrpcRouter,
} from "./annotation-trpc.mount.ts";
import type { ComposedAnnotationFeature } from "./annotation.composition.types.ts";

/** A capability this deployment did not compose, refused by name. */
export class ApiAnnotationUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });

    this.name = "ApiAnnotationUnavailableError";
  }
}

class UnavailableAnnotationApp implements AnnotationApi {
  #unavailable(): Promise<never> {
    return Promise.reject(new ApiAnnotationUnavailableError("annotation service"));
  }

  create: AnnotationApi["create"] = () => this.#unavailable();
  createUnattributed: AnnotationApi["createUnattributed"] = () => this.#unavailable();
  createReview: AnnotationApi["createReview"] = () => this.#unavailable();
  update: AnnotationApi["update"] = () => this.#unavailable();
  updateReview: AnnotationApi["updateReview"] = () => this.#unavailable();
  delete: AnnotationApi["delete"] = () => this.#unavailable();
  deleteReview: AnnotationApi["deleteReview"] = () => this.#unavailable();
  getById: AnnotationApi["getById"] = () => this.#unavailable();
  list: AnnotationApi["list"] = () => this.#unavailable();
  listWithFullUsers: AnnotationApi["listWithFullUsers"] = () => this.#unavailable();
  listWithUserSummaries: AnnotationApi["listWithUserSummaries"] = () => this.#unavailable();
  listReviewQueueItems: AnnotationApi["listReviewQueueItems"] = () => this.#unavailable();
  listOptimizedQueues: AnnotationApi["listOptimizedQueues"] = () => this.#unavailable();
  listForProjection: AnnotationApi["listForProjection"] = () => this.#unavailable();
  listScoreNames: AnnotationApi["listScoreNames"] = () => this.#unavailable();
  upsertScore: AnnotationApi["upsertScore"] = () => this.#unavailable();
  listScores: AnnotationApi["listScores"] = () => this.#unavailable();
  getScore: AnnotationApi["getScore"] = () => this.#unavailable();
  toggleScore: AnnotationApi["toggleScore"] = () => this.#unavailable();
  deleteScore: AnnotationApi["deleteScore"] = () => this.#unavailable();
  createQueueItems: AnnotationApi["createQueueItems"] = () => this.#unavailable();
  getProjectOrganizationId: AnnotationApi["getProjectOrganizationId"] = () => this.#unavailable();
  assertQueueConfigurationReferences: AnnotationApi["assertQueueConfigurationReferences"] = () =>
    this.#unavailable();
  assertAnnotatorReferences: AnnotationApi["assertAnnotatorReferences"] = () => this.#unavailable();
  configure: AnnotationApi["configure"] = () => this.#unavailable();
  listQueues: AnnotationApi["listQueues"] = () => this.#unavailable();
  getQueue: AnnotationApi["getQueue"] = () => this.#unavailable();
  tryGetQueue: AnnotationApi["tryGetQueue"] = () => this.#unavailable();
  listQueueItems: AnnotationApi["listQueueItems"] = () => this.#unavailable();
  countPendingItems: AnnotationApi["countPendingItems"] = () => this.#unavailable();
  countAssignedItems: AnnotationApi["countAssignedItems"] = () => this.#unavailable();
  listMemberQueuePendingCounts: AnnotationApi["listMemberQueuePendingCounts"] = () =>
    this.#unavailable();
  deleteQueueItems: AnnotationApi["deleteQueueItems"] = () => this.#unavailable();
  markQueueItemDone: AnnotationApi["markQueueItemDone"] = () => this.#unavailable();
  listQueueItemsPage: AnnotationApi["listQueueItemsPage"] = () => this.#unavailable();
  listQueuesWithItems: AnnotationApi["listQueuesWithItems"] = () => this.#unavailable();
  queueTraces: AnnotationApi["queueTraces"] = () => this.#unavailable();
}

export function refusingAnnotationFeature(): ComposedAnnotationFeature {
  const app = new UnavailableAnnotationApp();

  return {
    routers: (mount) => ({
      annotation: createAnnotationTrpcRouter(mount.runtime),
      annotationScore: createAnnotationScoreTrpcRouter(mount.runtime),
    }),
    app,
    restServices: { annotations: () => app },
  };
}
