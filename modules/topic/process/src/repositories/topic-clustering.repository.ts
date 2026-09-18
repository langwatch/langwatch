/**
 * Private persistence capability for the clustering runner and the boot
 * migration: project existence, topic model rows, the cost ledger, and
 * pre-cutover seed reads. Implemented by the Prisma repository.
 */

import type { Instant } from "@langwatch/time";

/** Topic identity + age rows behind the mode decision and cadence gate. */
export interface TopicClusteringTopicIndexRow {
  id: string;
  parentId: string | null;
  createdAt: Instant;
}

/** One model topic/subtopic row as the incremental clustering call needs it. */
export interface TopicClusteringModelRow {
  id: string;
  name: string;
  centroid: number[];
  p95Distance: number;
  parentId: string | null;
}

/** A full pre-ownership Topic row, recorded onto the stream by the seed. */
export interface TopicClusteringSeedTopicRow {
  id: string;
  name: string;
  parentId: string | null;
  embeddingsModel: string;
  centroid: number[];
  p95Distance: number;
  automaticallyGenerated: boolean;
  createdAt: Instant;
}

export abstract class TopicClusteringRepository {
  /** The project's existence; the runner reports a missing project itself. */
  abstract findProject(projectId: string): Promise<{ id: string } | null>;

  /** Every topic id/parent/age for the project (light index rows). */
  abstract findTopicIndexRows(projectId: string): Promise<TopicClusteringTopicIndexRow[]>;

  /** The current top-level model topics (centroids), for incremental runs. */
  abstract findModelTopics(projectId: string): Promise<TopicClusteringModelRow[]>;

  /** The current model subtopics (centroids), for incremental runs. */
  abstract findModelSubtopics(projectId: string): Promise<TopicClusteringModelRow[]>;

  /** The clustering call's cost row (CostType.CLUSTERING on the project). */
  abstract recordClusteringCost(params: {
    projectId: string;
    amount: number;
    currency: "USD" | "EUR";
    tracesCount: number;
    topicsCount: number;
    subtopicsCount: number;
    isIncremental: boolean;
  }): Promise<void>;

  /**
   * The projection cursor row, when the stream already owns this project's
   * topic model — the seed's ownership check.
   */
  abstract findTopicModelCursor(projectId: string): Promise<{ id: string } | null>;

  /** A project's full pre-ownership Topic rows, for the seed event. */
  abstract findSeedTopicRows(projectId: string): Promise<TopicClusteringSeedTopicRow[]>;

  // One page of projects that hold pre-ownership Topic rows (keyset paging O(1) per page).
  // Pages the GLOBAL `Project` model filtered by `topics: { some }` EXISTS filter.
  abstract findProjectsWithTopicsPage(params: {
    afterId: string | null;
    take: number;
  }): Promise<{ id: string }[]>;

  /**
   * One page of eligible projects (past their first message), ascending by
   * id. Can miss a project inserted mid-walk (nanoid ids aren't monotonic)
   * — harmless, since it gets scheduled by projectMetadata's bootstrap instead.
   */
  abstract findEligibleProjectsPage(params: {
    afterId: string | null;
    take: number;
  }): Promise<{ id: string }[]>;

  /** The subset that already has a topic-model cursor row. */
  abstract findOwnedTopicModelProjectIds(projectIds: string[]): Promise<string[]>;

  /**
   * The subset of `projectIds` that already has a scheduled topic clustering
   * wake. Those are skipped: re-requesting is a harmless no-op, but on a
   * large fleet it would append an event per project on every pass.
   */
  abstract findAlreadyScheduledProjectIds(projectIds: string[]): Promise<string[]>;
}
