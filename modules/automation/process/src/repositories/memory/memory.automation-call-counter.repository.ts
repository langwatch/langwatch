import { nowInstant } from "@langwatch/time";

import { AutomationCallCounterRepository } from "../automation-call-counter.repository.ts";

/** The fixed-window call count, held by this process. */
export class MemoryAutomationCallCounterRepository extends AutomationCallCounterRepository {
  static create(): MemoryAutomationCallCounterRepository {
    return new MemoryAutomationCallCounterRepository();
  }

  private readonly windows = new Map<string, { count: number; expiresAt: number }>();

  private constructor() {
    super();
  }

  count(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>> {
    const now = nowInstant().epochMilliseconds;
    const open = this.windows.get(input.key);
    const window =
      open !== undefined && open.expiresAt > now
        ? open
        : { count: 0, expiresAt: now + input.windowSeconds * 1000 };
    window.count += 1;
    this.windows.set(input.key, window);
    return Promise.resolve({ allowed: window.count <= input.max, resetAt: window.expiresAt });
  }
}
