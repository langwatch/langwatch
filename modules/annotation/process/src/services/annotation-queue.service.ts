import {
  type AnnotationQueueCaller,
  type AnnotationQueueItem,
  type AnnotationQueueListedItem,
  type AnnotationQueuePageItem,
  type AnnotationQueuePendingCount,
  type AnnotationQueueRecord,
  type AnnotationQueueWithItems,
  AnnotationQueueNameReservedError,
  AnnotationQueueNameTakenError,
  AnnotationQueueNotFoundError,
  type AnnotationQueueConfiguration,
  type AnnotationQueueDetail,
  type AnnotationQueueListEntry,
  type AnnotationQueueScope,
} from "@langwatch/annotation-contract";
import { fromDate } from "@langwatch/time";
import { z } from "zod";

import {
  type AnnotationQueueItemRepository,
  type AnnotationQueueWalkScope,
  type CreateAnnotationQueueItemsInput,
  type ListQueueItemsByUserInput,
} from "#repositories/annotation-queue-item.repository";
import type { AnnotationQueueRepository } from "#repositories/annotation-queue.repository";

const RESERVED_QUEUE_SLUGS = new Set(["all", "me", "my-queue"]);

/** How far ahead the walk looks for a readable item before calling the queue finished. */
const QUEUE_WALK_LOOKAHEAD = 50;

export type AnnotationQueueWalkPosition = Readonly<{
  item?: AnnotationQueuePageItem;
  position: number;
  total: number;
  previousItemId: string | null;
  nextItemId: string | null;
  /** A longer queue is never called finished, since work may wait past the window. */
  withinLookahead: boolean;
}>;

const createAnnotationQueueItemsInputSchema = z.strictObject({
  projectId: z.string().min(1),
  traceIds: z.array(z.string().min(1)),
  queueIds: z.array(z.string().min(1)),
  userIds: z.array(z.string().min(1)),
  createdByUserId: z.string().min(1),
});

export class AnnotationQueueService {
  #repository: AnnotationQueueRepository;
  #items: AnnotationQueueItemRepository;

  private constructor(repository: AnnotationQueueRepository, items: AnnotationQueueItemRepository) {
    this.#repository = repository;
    this.#items = items;
  }

  static create(
    input: Readonly<{ queues: AnnotationQueueRepository; items: AnnotationQueueItemRepository }>,
  ): AnnotationQueueService {
    return new AnnotationQueueService(input.queues, input.items);
  }

  async configure(input: AnnotationQueueConfiguration): Promise<AnnotationQueueRecord> {
    const slug = input.name
      .replace("_", "-")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (RESERVED_QUEUE_SLUGS.has(slug)) throw new AnnotationQueueNameReservedError(slug);

    if (input.queueId)
      return this.#repository.updateQueue({ ...input, slug, queueId: input.queueId });

    if (await this.#repository.queueSlugExists({ projectId: input.projectId, slug }))
      throw new AnnotationQueueNameTakenError(slug);

    return this.#repository.createQueue({ ...input, slug });
  }

  listQueues(
    input: AnnotationQueueScope & Readonly<{ reachableOnly?: boolean; userId?: string }>,
  ): Promise<AnnotationQueueListEntry[]> {
    return this.#repository.findQueues(input);
  }

  countQueues(
    input: Readonly<{ projectId: string; queueIds: readonly string[] }>,
  ): Promise<number> {
    return this.#repository.countQueues(input);
  }

  async getQueue(
    input: AnnotationQueueScope &
      Readonly<{
        organizationId: string;
        organizationMemberIds: readonly string[];
        slug?: string;
        queueId?: string;
      }>,
  ): Promise<AnnotationQueueDetail> {
    if (input.queueId) {
      return this.#repository.findQueueById({
        projectId: input.projectId,
        organizationId: input.organizationId,
        organizationMemberIds: input.organizationMemberIds,
        queueId: input.queueId,
      });
    }

    if (input.slug !== void 0) {
      return this.#repository.findQueueBySlug({
        projectId: input.projectId,
        organizationId: input.organizationId,
        organizationMemberIds: input.organizationMemberIds,
        slug: input.slug,
      });
    }

    throw new AnnotationQueueNotFoundError("unknown");
  }

  createQueueItems(input: CreateAnnotationQueueItemsInput): Promise<void> {
    return this.#items.createQueueItems(createAnnotationQueueItemsInputSchema.parse(input));
  }

  listQueueItems(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      organizationMemberIds: readonly string[];
    }>,
  ): Promise<readonly AnnotationQueueListedItem[]> {
    return this.#items.findQueueItems(input);
  }

  countPendingItems(input: AnnotationQueueCaller): Promise<number> {
    return this.#items.countPendingItems(input);
  }

  countAssignedItems(input: AnnotationQueueCaller): Promise<number> {
    return this.#items.countAssignedItems(input);
  }

  listMemberQueuePendingCounts(
    input: AnnotationQueueCaller,
  ): Promise<readonly AnnotationQueuePendingCount[]> {
    return this.#items.findMemberQueuePendingCounts(input);
  }

  deleteQueueItems(
    input: AnnotationQueueCaller &
      Readonly<{
        organizationId: string;
        organizationMemberIds: readonly string[];
        queueItemIds: readonly string[];
      }>,
  ): Promise<number> {
    return this.#items.deleteQueueItems(input);
  }

  async markQueueItemDone(
    input: AnnotationQueueCaller &
      Readonly<{
        organizationId: string;
        organizationMemberIds: readonly string[];
        queueItemId: string;
      }>,
  ): Promise<AnnotationQueueItem> {
    return this.#items.markQueueItemDone(input);
  }

  listQueueItemsPage(
    input: ListQueueItemsByUserInput & Readonly<{ queueId?: string }>,
  ): Promise<Readonly<{ totalCount: number; items: readonly AnnotationQueuePageItem[] }>> {
    if (input.queueId) {
      return this.#items.findQueueItemsByQueue({
        projectId: input.projectId,
        organizationId: input.organizationId,
        organizationMemberIds: input.organizationMemberIds,
        queueId: input.queueId,
        status: input.status,
        pickedQueueIds: input.pickedQueueIds,
        startDate: input.startDate,
        endDate: input.endDate,
        pageSize: input.pageSize,
        pageOffset: input.pageOffset,
        allQueueItems: input.allQueueItems,
      });
    }

    return this.#items.findQueueItemsByUser(input);
  }

  listQueuesWithItems(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      organizationMemberIds: readonly string[];
      queueIds: readonly string[];
    }>,
  ): Promise<readonly AnnotationQueueWithItems[]> {
    return this.#items.findQueuesWithItems(input);
  }

  /** Seeks outwards from the current item, so a step costs the same on any queue length. */
  async getQueueWalkPosition(
    input: AnnotationQueueWalkScope & Readonly<{ queueItemId?: string }>,
  ): Promise<AnnotationQueueWalkPosition> {
    const total = await this.#items.countQueueWalkItems(input);
    const [item] = await this.#items.findQueueWalkItems(input);
    if (item === undefined) {
      return { position: 0, total, previousItemId: null, nextItemId: null, withinLookahead: true };
    }

    const place = await this.#items.getQueueWalkPlace({
      ...input,
      current: { id: item.id, createdAt: fromDate(item.createdAt) },
    });

    return {
      item,
      position: place.ahead + 1,
      total,
      previousItemId: place.previousItemId,
      nextItemId: place.nextItemId,
      withinLookahead: total <= QUEUE_WALK_LOOKAHEAD,
    };
  }

  findQueueWalkLookaheadTraceIds(input: AnnotationQueueWalkScope): Promise<readonly string[]> {
    return this.#items.findQueueWalkTraceIds({ ...input, take: QUEUE_WALK_LOOKAHEAD });
  }
}
