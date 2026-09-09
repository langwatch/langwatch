/**
 * The resolved-ARN store a process with no shared cache falls back to.
 *
 * Slower rather than wrong: every pod resolves each project once for itself
 * instead of the first resolution anywhere warming the fleet, which is what
 * the regional control-plane quota cares about. A deployment that composes a
 * shared store gets that back.
 */
import { NlpLambdaArnCachePort } from "../ports/nlp-lambda-arn.port.ts";

type Entry = Readonly<{ value: string; expiresAt: number }>;

export class InMemoryNlpLambdaArnCacheAdapter extends NlpLambdaArnCachePort {
  static create(options: { now?: () => number } = {}): InMemoryNlpLambdaArnCacheAdapter {
    return new InMemoryNlpLambdaArnCacheAdapter(options.now ?? Date.now);
  }

  private readonly entries = new Map<string, Entry>();

  private constructor(private readonly now: () => number) {
    super();
  }

  tryGet(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(null);

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);

      return Promise.resolve(null);
    }

    return Promise.resolve(entry.value);
  }

  set(input: { key: string; value: string; ttlSeconds: number }): Promise<void> {
    this.entries.set(input.key, {
      value: input.value,
      expiresAt: this.now() + input.ttlSeconds * 1000,
    });

    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);

    return Promise.resolve();
  }
}
