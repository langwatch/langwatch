import {
  LWQL_ACCESS_MODEL_ANSWER_TTL_MS,
  type LangWatchQLAccessModelAnswer,
  LangWatchQLAccessModelAnswerRepository,
} from "../langwatch-ql-access-model-answer.repository.ts";

/** The answers in process memory, one per origin, expiring on the given clock as Redis would. */
export class MemoryLangWatchQLAccessModelAnswerRepository extends LangWatchQLAccessModelAnswerRepository {
  readonly #held = new Map<string, { answer: LangWatchQLAccessModelAnswer; until: number }>();

  private constructor(private readonly now: () => number) {
    super();
  }

  static create({
    now = Date.now,
  }: { now?: () => number } = {}): MemoryLangWatchQLAccessModelAnswerRepository {
    return new MemoryLangWatchQLAccessModelAnswerRepository(now);
  }

  findAnswer({ origin }: { origin: string }): Promise<LangWatchQLAccessModelAnswer | null> {
    const held = this.#held.get(origin);
    return Promise.resolve(held !== undefined && held.until > this.now() ? held.answer : null);
  }

  recordAnswer({
    origin,
    answer,
  }: {
    origin: string;
    answer: LangWatchQLAccessModelAnswer;
  }): Promise<void> {
    this.#held.set(origin, { answer, until: this.now() + LWQL_ACCESS_MODEL_ANSWER_TTL_MS });
    return Promise.resolve();
  }
}
