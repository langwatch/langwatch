import { nanoid } from "nanoid";
import {
  AnnotationQueueNotFoundError,
  type AnnotationQueueDetail,
  type AnnotationQueueListEntry,
  type AnnotationQueueRecord,
} from "@langwatch/annotation-contract";
import { nowInstant, toDate } from "@langwatch/time";
import type {
  AnnotationQueueRepository,
  QueueCountInput,
  QueueCreateInput,
  QueueByIdInput,
  QueueBySlugInput,
  QueueListInput,
  QueueSlugInput,
  QueueUpdateInput,
} from "../annotation-queue.repository.ts";
import type { MemoryAnnotationQueueDatabase } from "./memory.annotation-queue.database.ts";

export class MemoryAnnotationQueueRepository implements AnnotationQueueRepository {
  #database: MemoryAnnotationQueueDatabase;
  private constructor(database: MemoryAnnotationQueueDatabase) {
    this.#database = database;
  }
  static create({
    database,
  }: Readonly<{ database: MemoryAnnotationQueueDatabase }>): MemoryAnnotationQueueRepository {
    return new MemoryAnnotationQueueRepository(database);
  }
  async countQueues({ projectId, queueIds }: QueueCountInput): Promise<number> {
    return this.#database
      .queues()
      .filter((queue) => queue.projectId === projectId && queueIds.includes(queue.id)).length;
  }
  async queueSlugExists({ projectId, slug }: QueueSlugInput): Promise<boolean> {
    return this.#database
      .queues()
      .some((queue) => queue.projectId === projectId && queue.slug === slug);
  }
  async createQueue(input: QueueCreateInput): Promise<AnnotationQueueRecord> {
    const now = toDate(nowInstant());
    const queue = { id: nanoid(), ...input, createdAt: now, updatedAt: now };
    this.#database.replaceQueues([...this.#database.queues(), queue]);

    return structuredClone(queue);
  }
  async updateQueue(input: QueueUpdateInput): Promise<AnnotationQueueRecord> {
    const previous = this.#database
      .queues()
      .find((queue) => queue.id === input.queueId && queue.projectId === input.projectId);

    if (!previous) throw new AnnotationQueueNotFoundError(input.queueId);

    const queue = { ...previous, ...input, id: previous.id, updatedAt: toDate(nowInstant()) };

    this.#database.replaceQueues(
      this.#database.queues().map((existing) => (existing.id === queue.id ? queue : existing)),
    );

    return structuredClone(queue);
  }
  async listQueues({
    projectId,
    reachableOnly,
    userId,
  }: QueueListInput): Promise<AnnotationQueueListEntry[]> {
    return this.#database
      .queues()
      .filter(
        (queue) =>
          queue.projectId === projectId &&
          (!reachableOnly ||
            userId === void 0 ||
            queue.userIds.includes(userId) ||
            this.#database
              .items()
              .some((item) => item.annotationQueueId === queue.id && item.userId === userId)),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(({ id, name, slug }) => ({ id, name, slug }));
  }
  #detail(
    queue: ReturnType<MemoryAnnotationQueueDatabase["queues"]>[number],
    organizationMemberIds: readonly string[],
  ) {
    return {
      ...structuredClone(queue),
      members: queue.userIds
        .filter((id) => organizationMemberIds.includes(id))
        .map((id) => ({ user: { id, name: null, image: null } })),
      AnnotationQueueScores: queue.scoreTypeIds.flatMap((id) => {
        const name = this.#database.scoreName(queue.projectId, id);

        return name === undefined ? [] : [{ annotationScore: { id, name } }];
      }),
    };
  }
  async getQueueById({
    projectId,
    organizationMemberIds,
    queueId,
  }: QueueByIdInput): Promise<AnnotationQueueDetail> {
    const queue = this.#database
      .queues()
      .find((candidate) => candidate.projectId === projectId && candidate.id === queueId);

    if (!queue) throw new AnnotationQueueNotFoundError(queueId);

    return this.#detail(queue, organizationMemberIds);
  }
  async getQueueBySlug({
    projectId,
    organizationMemberIds,
    slug,
  }: QueueBySlugInput): Promise<AnnotationQueueDetail> {
    const queue = this.#database
      .queues()
      .find((candidate) => candidate.projectId === projectId && candidate.slug === slug);

    if (!queue) throw new AnnotationQueueNotFoundError(slug);

    return this.#detail(queue, organizationMemberIds);
  }
}
