import type {
  AnnotationQueueItem,
  AnnotationQueueRecord,
  AnnotationScore,
} from "@langwatch/annotation-contract";

export type MemoryAnnotationQueue = AnnotationQueueRecord &
  Readonly<{
    userIds: readonly string[];
    scoreTypeIds: readonly string[];
  }>;

/** Process-owned state passed to every in-memory annotation queue repository. */
export class MemoryAnnotationQueueDatabase {
  #queues: MemoryAnnotationQueue[] = [];
  #items: AnnotationQueueItem[] = [];
  #scores = new Map<string, AnnotationScore>();

  private constructor() {}

  static create(): MemoryAnnotationQueueDatabase {
    return new MemoryAnnotationQueueDatabase();
  }

  queues(): readonly MemoryAnnotationQueue[] {
    return this.#queues;
  }
  items(): readonly AnnotationQueueItem[] {
    return this.#items;
  }
  replaceQueues(queues: readonly MemoryAnnotationQueue[]) {
    this.#queues = [...queues];
  }
  replaceItems(items: readonly AnnotationQueueItem[]) {
    this.#items = [...items];
  }
  score(projectId: string, scoreId: string): AnnotationScore | undefined {
    return this.#scores.get(`${projectId}:${scoreId}`);
  }
  scores(): readonly AnnotationScore[] {
    return [...this.#scores.values()];
  }
  replaceScore(score: AnnotationScore) {
    this.#scores.set(`${score.projectId}:${score.id}`, score);
  }
  scoreName(projectId: string, scoreId: string) {
    return this.score(projectId, scoreId)?.name;
  }
}
