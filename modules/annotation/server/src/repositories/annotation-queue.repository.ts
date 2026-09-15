import type {
  AnnotationQueueRecord,
  AnnotationQueueDetail,
  AnnotationQueueListEntry,
  AnnotationQueueScope,
} from "@langwatch/annotation-contract";

type AnnotationQueueOrganizationScope = AnnotationQueueScope &
  Readonly<{
    organizationId: string;
    organizationMemberIds: readonly string[];
  }>;

export type QueueByIdInput = AnnotationQueueOrganizationScope & Readonly<{ queueId: string }>;
export type QueueBySlugInput = AnnotationQueueOrganizationScope & Readonly<{ slug: string }>;
export type QueueCountInput = AnnotationQueueScope & Readonly<{ queueIds: readonly string[] }>;
export type QueueSlugInput = AnnotationQueueScope & Readonly<{ slug: string }>;
export type QueueListInput = AnnotationQueueScope &
  Readonly<{ reachableOnly?: boolean; userId?: string }>;
export type QueueCreateInput = AnnotationQueueScope &
  Readonly<{
    name: string;
    slug: string;
    description: string;
    userIds: readonly string[];
    scoreTypeIds: readonly string[];
  }>;
export type QueueUpdateInput = QueueCreateInput & Readonly<{ queueId: string }>;

export interface AnnotationQueueRepository {
  countQueues(input: QueueCountInput): Promise<number>;
  /** Whether the project already has a queue addressed by this slug. */
  queueSlugExists(input: QueueSlugInput): Promise<boolean>;
  createQueue(input: QueueCreateInput): Promise<AnnotationQueueRecord>;
  updateQueue(input: QueueUpdateInput): Promise<AnnotationQueueRecord>;
  /** The project's queues, newest first, for the picker. */
  listQueues(input: QueueListInput): Promise<AnnotationQueueListEntry[]>;
  getQueueById(input: QueueByIdInput): Promise<AnnotationQueueDetail>;
  getQueueBySlug(input: QueueBySlugInput): Promise<AnnotationQueueDetail>;
}
