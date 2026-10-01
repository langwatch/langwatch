import type {
  AnnotationQueueItem,
  AnnotationQueueItemStatus,
  AnnotationQueueListedItem,
  AnnotationQueuePageItem,
  AnnotationQueueWithItems,
} from "@langwatch/annotation-contract";
import type { Instant } from "@langwatch/time";

export type CreateAnnotationQueueItemsInput = Readonly<{
  projectId: string;
  traceIds: readonly string[];
  queueIds: readonly string[];
  userIds: readonly string[];
  createdByUserId: string;
}>;
export type AnnotationQueueItemOrganizationScope = Readonly<{
  projectId: string;
  organizationId: string;
  organizationMemberIds: readonly string[];
}>;
export type AnnotationQueueItemCaller = Readonly<{ projectId: string; userId: string }>;
export type DeleteAnnotationQueueItemsInput = AnnotationQueueItemOrganizationScope &
  AnnotationQueueItemCaller &
  Readonly<{ queueItemIds: readonly string[] }>;
export type MarkAnnotationQueueItemDoneInput = AnnotationQueueItemOrganizationScope &
  AnnotationQueueItemCaller &
  Readonly<{ queueItemId: string }>;
export type ListQueueItemsPageInput = AnnotationQueueItemOrganizationScope &
  Readonly<{
    status: AnnotationQueueItemStatus;
    pickedQueueIds?: readonly string[];
    startDate?: Instant;
    endDate?: Instant;
    pageSize: number;
    pageOffset: number;
    allQueueItems: boolean;
  }>;
export type ListQueueItemsByUserInput = ListQueueItemsPageInput &
  AnnotationQueueItemCaller &
  Readonly<{ includeMemberQueues: boolean }>;
export type ListQueueItemsByQueueInput = ListQueueItemsPageInput & Readonly<{ queueId: string }>;
export type ListAnnotationQueuesWithItemsInput = AnnotationQueueItemOrganizationScope &
  Readonly<{ queueIds: readonly string[] }>;

/** The caller's pending queue, which is the only set the walk steps through. */
export type AnnotationQueueWalkScope = AnnotationQueueItemOrganizationScope &
  AnnotationQueueItemCaller;
export type AnnotationQueueWalkPlace = Readonly<{
  ahead: number;
  previousItemId: string | null;
  nextItemId: string | null;
}>;

export type AnnotationQueueItemsPage = Readonly<{
  totalCount: number;
  items: readonly AnnotationQueuePageItem[];
}>;

/** Private persistence capability for queue-item work. */
export interface AnnotationQueueItemRepository {
  createQueueItems(input: CreateAnnotationQueueItemsInput): Promise<void>;
  findQueueItems(
    input: AnnotationQueueItemOrganizationScope,
  ): Promise<readonly AnnotationQueueListedItem[]>;
  countPendingItems(input: AnnotationQueueItemCaller): Promise<number>;
  countAssignedItems(input: AnnotationQueueItemCaller): Promise<number>;
  findMemberQueuePendingCounts(
    input: AnnotationQueueItemCaller,
  ): Promise<readonly Readonly<{ id: string; name: string; slug: string; pendingCount: number }>[]>;
  deleteQueueItems(input: DeleteAnnotationQueueItemsInput): Promise<number>;
  markQueueItemDone(input: MarkAnnotationQueueItemDoneInput): Promise<AnnotationQueueItem>;
  findQueueItemsByUser(input: ListQueueItemsByUserInput): Promise<AnnotationQueueItemsPage>;
  findQueueItemsByQueue(input: ListQueueItemsByQueueInput): Promise<AnnotationQueueItemsPage>;
  findQueuesWithItems(
    input: ListAnnotationQueuesWithItemsInput,
  ): Promise<readonly AnnotationQueueWithItems[]>;
  countQueueWalkItems(input: AnnotationQueueWalkScope): Promise<number>;
  /** The named item when it is still in the walk, else the front of it; at most one. */
  findQueueWalkItems(
    input: AnnotationQueueWalkScope & Readonly<{ queueItemId?: string }>,
  ): Promise<readonly AnnotationQueuePageItem[]>;
  getQueueWalkPlace(
    input: AnnotationQueueWalkScope &
      Readonly<{ current: Readonly<{ id: string; createdAt: Instant }> }>,
  ): Promise<AnnotationQueueWalkPlace>;
  findQueueWalkTraceIds(
    input: AnnotationQueueWalkScope & Readonly<{ take: number }>,
  ): Promise<readonly string[]>;
}
