import { nowInstant } from "@langwatch/time";

import type { NlpLambdaArnCache } from "../../app/workflow.app.ts";

/** One process's resolved functions, for a process with no shared Redis. */
export class MemoryNlpLambdaArnRepository implements NlpLambdaArnCache {
  static create(): MemoryNlpLambdaArnRepository {
    return new MemoryNlpLambdaArnRepository();
  }

  private readonly entries = new Map<string, { value: string; expiresAtMs: number }>();

  private constructor() {}

  find(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAtMs <= nowInstant().epochMilliseconds) {
      return Promise.resolve(null);
    }

    return Promise.resolve(entry.value);
  }

  set(input: { key: string; value: string; ttlSeconds: number }): Promise<void> {
    const expiresAtMs = nowInstant().epochMilliseconds + input.ttlSeconds * 1000;
    this.entries.set(input.key, { value: input.value, expiresAtMs });

    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);

    return Promise.resolve();
  }
}
