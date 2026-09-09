import { z } from "zod";
import {
  type AnnotationQueueCaller,
  type AnnotationQueueItem,
  type AnnotationQueueListedItem,
  type AnnotationQueuePageItem,
  type AnnotationQueuePendingCount,
  type AnnotationQueueRecord,
  type AnnotationQueueWithItems,
} from "@langwatch/annotation-contract";
import {
  type AnnotationQueueItemRepository,
  type CreateAnnotationQueueItemsInput,
  type ListQueueItemsByUserInput,
} from "#repositories/annotation-queue-item.repository";

import {
  AnnotationQueueNameReservedError,
  AnnotationQueueNameTakenError,
  AnnotationQueueNotFoundError,
  type AnnotationQueueConfiguration,
  type AnnotationQueueDetail,
  type AnnotationQueueListEntry,
  type AnnotationQueueScope,
} from "@langwatch/annotation-contract";
import type { AnnotationQueueRepository } from "#repositories/annotation-queue.repository";

const RESERVED_QUEUE_SLUGS = new Set(["all", "me", "my-queue"]);

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
    return this.#repository.listQueues(input);
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
      return this.#repository.getQueueById({
        projectId: input.projectId,
        organizationId: input.organizationId,
        organizationMemberIds: input.organizationMemberIds,
        queueId: input.queueId,
      });
    }

    if (input.slug !== void 0) {
      return this.#repository.getQueueBySlug({
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
    return this.#items.listQueueItems(input);
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
    return this.#items.listMemberQueuePendingCounts(input);
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
      return this.#items.listQueueItemsByQueue({
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

    return this.#items.listQueueItemsByUser(input);
  }
  listQueuesWithItems(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      organizationMemberIds: readonly string[];
      queueIds: readonly string[];
    }>,
  ): Promise<readonly AnnotationQueueWithItems[]> {
    return this.#items.listQueuesWithItems(input);
  }
}
