// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { nowInstant } from "@langwatch/time";

import type { DigestCallCounterRepository } from "../digest-call-counter.repository.ts";

/** The fixed-window call count, held by this process. */
export class MemoryDigestCallCounterRepository implements DigestCallCounterRepository {
  readonly #windows = new Map<string, { count: number; expiresAt: number }>();

  static create(): MemoryDigestCallCounterRepository {
    return new MemoryDigestCallCounterRepository();
  }

  async count(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean }>> {
    const now = nowInstant().epochMilliseconds;
    const open = this.#windows.get(input.key);
    const window =
      open !== undefined && open.expiresAt > now
        ? open
        : { count: 0, expiresAt: now + input.windowSeconds * 1000 };
    window.count += 1;
    this.#windows.set(input.key, window);
    return { allowed: window.count <= input.max };
  }
}
