import { nowInstant } from "@langwatch/time";

import type { OrganizationInviteRateLimit } from "../../app/organization.members.ts";

/** The Redis counter's memory twin: one fixed window per key, held in this process. */
export class MemoryOrganizationInviteRateLimitRepository implements OrganizationInviteRateLimit {
  static create(): MemoryOrganizationInviteRateLimitRepository {
    return new MemoryOrganizationInviteRateLimitRepository();
  }

  private readonly windows = new Map<string, { used: number; resetAt: number }>();

  private constructor() {}

  limit(
    input: Readonly<{ key: string; windowSeconds: number; max: number; count?: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>> {
    const now = nowInstant().epochMilliseconds;
    const open = this.windows.get(input.key);
    const window =
      open && open.resetAt > now ? open : { used: 0, resetAt: now + input.windowSeconds * 1000 };
    window.used += input.count ?? 1;
    this.windows.set(input.key, window);
    return Promise.resolve({ allowed: window.used <= input.max, resetAt: window.resetAt });
  }
}
