import { nanoid } from "nanoid";
import { nowInstant, toDate } from "@langwatch/time";
import {
  AnnotationQueueItemNotFoundError,
  annotationQueueItemSchema,
  annotationQueueListedItemSchema,
  annotationQueuePageItemSchema,
  annotationQueueWithItemsSchema,
  type AnnotationQueueItem,
  type AnnotationQueueListedItem,
  type AnnotationQueueWithItems,
} from "@langwatch/annotation-contract";
import type {
  AnnotationQueueItemCaller,
  AnnotationQueueItemOrganizationScope,
  AnnotationQueueItemRepository,
  CreateAnnotationQueueItemsInput,
  DeleteAnnotationQueueItemsInput,
  ListQueueItemsByQueueInput,
  ListQueueItemsByUserInput,
  ListQueueItemsPageInput,
  ListAnnotationQueuesWithItemsInput,
  MarkAnnotationQueueItemDoneInput,
  AnnotationQueueItemsPage,
} from "../annotation-queue-item.repository.ts";
import type { MemoryAnnotationQueueDatabase } from "./memory.annotation-queue.database.ts";

export class MemoryAnnotationQueueItemRepository implements AnnotationQueueItemRepository {
  #database: MemoryAnnotationQueueDatabase;
  private constructor(database: MemoryAnnotationQueueDatabase) {
    this.#database = database;
  }
  static create({
    memory,
  }: Readonly<{ memory: MemoryAnnotationQueueDatabase }>): MemoryAnnotationQueueItemRepository {
    return new MemoryAnnotationQueueItemRepository(memory);
  }

  #queueFor(item: { annotationQueueId: string | null; projectId: string }) {
    return item.annotationQueueId === null
      ? undefined
      : this.#database
          .queues()
          .find(
            (queue) => queue.id === item.annotationQueueId && queue.projectId === item.projectId,
          );
  }

  #isVisibleToOrganization(
    item: { annotationQueueId: string | null; userId: string | null; projectId: string },
    organizationMemberIds: readonly string[],
  ) {
    return (
      (item.annotationQueueId === null || this.#queueFor(item) !== undefined) &&
      (item.userId === null || organizationMemberIds.includes(item.userId))
    );
  }

  #isReachableByUser(
    item: { annotationQueueId: string | null; userId: string | null; projectId: string },
    userId: string,
  ) {
    const queue = this.#queueFor(item);

    return item.userId === userId || (queue !== undefined && queue.userIds.includes(userId));
  }
  async createQueueItems(input: CreateAnnotationQueueItemsInput): Promise<void> {
    const now = toDate(nowInstant());

    const additions = input.traceIds.flatMap((traceId) =>
      [
        ...input.queueIds.map((annotationQueueId) => ({ annotationQueueId, userId: null })),
        ...input.userIds.map((userId) => ({ annotationQueueId: null, userId })),
      ].map((target) => ({
        id: nanoid(),
        ...target,
        traceId,
        projectId: input.projectId,
        createdByUserId: input.createdByUserId,
        createdAt: now,
        updatedAt: now,
        doneAt: null,
        markedForDatasetAt: null,
      })),
    );

    const existing = this.#database.items().map((item) => {
      const isExistingTarget =
        input.traceIds.includes(item.traceId) &&
        item.projectId === input.projectId &&
        ((item.annotationQueueId !== null && input.queueIds.includes(item.annotationQueueId)) ||
          (item.userId !== null && input.userIds.includes(item.userId)));

      return isExistingTarget ? { ...item, doneAt: null, updatedAt: now } : item;
    });

    const keys = new Set(
      existing.map(
        (item) => `${item.projectId}:${item.traceId}:${item.annotationQueueId ?? item.userId}`,
      ),
    );

    this.#database.replaceItems([
      ...existing,
      ...additions.filter(
        (item) =>
          !keys.has(`${item.projectId}:${item.traceId}:${item.annotationQueueId ?? item.userId}`),
      ),
    ]);
  }
  async listQueueItems({
    projectId,
    organizationMemberIds,
  }: AnnotationQueueItemOrganizationScope): Promise<readonly AnnotationQueueListedItem[]> {
    return this.#database
      .items()
      .filter(
        (item) =>
          item.projectId === projectId &&
          this.#isVisibleToOrganization(item, organizationMemberIds),
      )
      .map((item) => {
        const queue = this.#queueFor(item);

        return {
          ...item,
          user: item.userId ? { id: item.userId, name: null, image: null } : null,
          createdByUser: item.createdByUserId
            ? { id: item.createdByUserId, name: null, image: null }
            : null,
          annotationQueue:
            queue === undefined
              ? null
              : {
                  ...queue,
                  members: queue.userIds
                    .filter((id) => organizationMemberIds.includes(id))
                    .map((userId) => ({ annotationQueueId: queue.id, userId })),
                },
        };
      })
      .map((item) => annotationQueueListedItemSchema.parse(structuredClone(item)));
  }
  async countPendingItems({ projectId, userId }: AnnotationQueueItemCaller): Promise<number> {
    return this.#database
      .items()
      .filter(
        (item) =>
          item.projectId === projectId &&
          item.doneAt === null &&
          this.#isReachableByUser(item, userId),
      ).length;
  }
  async countAssignedItems({ projectId, userId }: AnnotationQueueItemCaller): Promise<number> {
    return this.#database
      .items()
      .filter(
        (item) => item.projectId === projectId && item.userId === userId && item.doneAt === null,
      ).length;
  }
  async listMemberQueuePendingCounts({
    projectId,
    userId,
  }: AnnotationQueueItemCaller): Promise<
    ReadonlyArray<Readonly<{ id: string; name: string; slug: string; pendingCount: number }>>
  > {
    return this.#database
      .queues()
      .filter((queue) => queue.projectId === projectId && queue.userIds.includes(userId))
      .map((queue) => ({
        id: queue.id,
        name: queue.name,
        slug: queue.slug,
        pendingCount: this.#database
          .items()
          .filter(
            (item) =>
              item.projectId === projectId &&
              item.annotationQueueId === queue.id &&
              item.doneAt === null,
          ).length,
      }));
  }
  async deleteQueueItems({
    projectId,
    organizationMemberIds,
    userId,
    queueItemIds,
  }: DeleteAnnotationQueueItemsInput): Promise<number> {
    const removable = new Set(
      this.#database
        .items()
        .filter(
          (item) =>
            item.projectId === projectId &&
            queueItemIds.includes(item.id) &&
            this.#isVisibleToOrganization(item, organizationMemberIds) &&
            this.#isReachableByUser(item, userId),
        )
        .map((item) => item.id),
    );

    this.#database.replaceItems(this.#database.items().filter((item) => !removable.has(item.id)));

    return removable.size;
  }
  async markQueueItemDone({
    projectId,
    organizationMemberIds,
    userId,
    queueItemId,
  }: MarkAnnotationQueueItemDoneInput): Promise<AnnotationQueueItem> {
    const item = this.#database
      .items()
      .find(
        (candidate) =>
          candidate.id === queueItemId &&
          candidate.projectId === projectId &&
          this.#isVisibleToOrganization(candidate, organizationMemberIds) &&
          this.#isReachableByUser(candidate, userId),
      );

    if (!item) throw new AnnotationQueueItemNotFoundError(queueItemId);

    const done = { ...item, doneAt: toDate(nowInstant()), updatedAt: toDate(nowInstant()) };

    this.#database.replaceItems(
      this.#database.items().map((candidate) => (candidate.id === item.id ? done : candidate)),
    );

    return annotationQueueItemSchema.parse(structuredClone(done));
  }
  async listQueueItemsByUser(input: ListQueueItemsByUserInput): Promise<AnnotationQueueItemsPage> {
    const items = await this.listQueueItems(input);

    const reachable = items.filter((item) =>
      input.includeMemberQueues
        ? item.userId === input.userId ||
          (item.annotationQueueId !== null && this.#isReachableByUser(item, input.userId))
        : item.userId === input.userId,
    );

    return this.#page(input, reachable);
  }
  async listQueueItemsByQueue(
    input: ListQueueItemsByQueueInput,
  ): Promise<AnnotationQueueItemsPage> {
    const items = await this.listQueueItems(input);

    return this.#page(
      input,
      items.filter((item) => item.annotationQueueId === input.queueId),
    );
  }
  #page(input: ListQueueItemsPageInput, items: readonly AnnotationQueueListedItem[]) {
    const startDate = input.startDate ? toDate(input.startDate) : void 0;
    const endDate = input.endDate ? toDate(input.endDate) : void 0;

    const filtered = items
      .filter(
        (item) =>
          (input.status === "all" || (input.status === "pending") === (item.doneAt === null)) &&
          (!startDate || item.createdAt >= startDate) &&
          (!endDate || item.createdAt <= endDate) &&
          (!input.pickedQueueIds?.length ||
            (item.annotationQueueId !== null &&
              input.pickedQueueIds.includes(item.annotationQueueId))),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      totalCount: filtered.length,
      items: (input.allQueueItems
        ? filtered
        : filtered.slice(input.pageOffset, input.pageOffset + input.pageSize)
      ).map((item) => this.#pageItem(item, input.organizationMemberIds)),
    };
  }
  #pageItem(item: AnnotationQueueListedItem, organizationMemberIds: readonly string[]) {
    const queue = this.#queueFor(item);

    if (queue === undefined)
      return annotationQueuePageItemSchema.parse({ ...item, annotationQueue: null });

    return annotationQueuePageItemSchema.parse({
      ...item,
      annotationQueue: {
        ...queue,
        members: queue.userIds
          .filter((userId) => organizationMemberIds.includes(userId))
          .map((id) => ({ user: { id, name: null, image: null } })),
        AnnotationQueueScores: queue.scoreTypeIds.flatMap((id) => {
          const name = this.#database.scoreName(queue.projectId, id);

          return name === undefined ? [] : [{ annotationScore: { id, name } }];
        }),
      },
    });
  }
  async listQueuesWithItems({
    projectId,
    organizationMemberIds,
    queueIds,
  }: ListAnnotationQueuesWithItemsInput): Promise<readonly AnnotationQueueWithItems[]> {
    return this.#database
      .queues()
      .filter((queue) => queue.projectId === projectId && queueIds.includes(queue.id))
      .map((queue) => ({
        ...queue,
        members: queue.userIds
          .filter((id) => organizationMemberIds.includes(id))
          .map((id) => ({ user: { id, name: null, image: null } })),
        AnnotationQueueScores: queue.scoreTypeIds.flatMap((id) => {
          const name = this.#database.scoreName(queue.projectId, id);

          return name === undefined ? [] : [{ annotationScore: { id, name } }];
        }),
        AnnotationQueueItems: this.#database
          .items()
          .filter((item) => item.annotationQueueId === queue.id)
          .map((item) => ({
            ...item,
            user: item.userId ? { id: item.userId, name: null, image: null } : null,
            annotationQueue: queue,
          })),
      }))
      .map((queue) => annotationQueueWithItemsSchema.parse(structuredClone(queue)));
  }
}
