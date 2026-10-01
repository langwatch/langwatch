import {
  AnnotationScoreNotFoundError,
  type AnnotationQueueItem,
  type AnnotationQueueRecord,
  type AnnotationScore,
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
  replaceQueues(queues: readonly MemoryAnnotationQueue[]): void {
    this.#queues = [...queues];
  }
  replaceItems(items: readonly AnnotationQueueItem[]): void {
    this.#items = [...items];
  }
  getScore(projectId: string, scoreId: string): AnnotationScore {
    const score = this.#scores.get(`${projectId}:${scoreId}`);
    if (!score) throw new AnnotationScoreNotFoundError(scoreId);
    return score;
  }
  findScores(projectId: string, scoreIds: readonly string[]): AnnotationScore[] {
    return scoreIds.flatMap((id) => {
      const score = this.#scores.get(`${projectId}:${id}`);
      return score ? [score] : [];
    });
  }
  scores(): readonly AnnotationScore[] {
    return [...this.#scores.values()];
  }
  replaceScore(score: AnnotationScore): void {
    this.#scores.set(`${score.projectId}:${score.id}`, score);
  }
}
