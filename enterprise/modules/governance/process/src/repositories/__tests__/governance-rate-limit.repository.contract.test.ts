// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The push receivers' throttle answers alike over its memory twin and over the Redis limiter's
 * fixed-window script (run here on a counter that honours INCR, TTL and EXPIRE).
 * Spec: enterprise/modules/governance/specs/governance.feature
 */
import { redisRateLimiter } from "@langwatch/process-stores";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { GovernanceRateLimitRepository } from "../governance-rate-limit.repository.ts";
import { MemoryGovernanceRateLimitRepository } from "../memory/memory.governance-rate-limit.repository.ts";
import { RedisGovernanceRateLimitRepository } from "../redis/redis.governance-rate-limit.repository.ts";

type RedisFixture = Parameters<typeof redisRateLimiter>[0];

/** A Redis counter with a window: the one script the limiter sends, and the TTL it reads. */
function windowedCounter(): RedisFixture {
  const counters = new Map<string, { used: number; expiresAt: number }>();
  return createApiFixture<RedisFixture>(
    {
      eval: async (...args: unknown[]) => {
        const [key, seconds] = [String(args[2]), Number(args[3])];
        const open = counters.get(key);
        const counter =
          open && open.expiresAt > Date.now()
            ? open
            : { used: 0, expiresAt: Date.now() + seconds * 1000 };
        counter.used += 1;
        counters.set(key, counter);
        return counter.used;
      },
      ttl: async (...args: unknown[]) => {
        const key = String(args[0]);
        const open = counters.get(key);
        return open ? Math.ceil((open.expiresAt - Date.now()) / 1000) : -2;
      },
    },
    "redis",
  );
}

const LIMIT = { requests: 2, seconds: 60 } as const;

function contractCases(makeRepository: () => GovernanceRateLimitRepository): void {
  it("allows requests up to the limit", async () => {
    const repository = makeRepository();

    await expect(repository.check("org_a", LIMIT)).resolves.toEqual({ allowed: true });
    await expect(repository.check("org_a", LIMIT)).resolves.toEqual({ allowed: true });
  });

  it("refuses the request past the limit and says when to retry", async () => {
    const repository = makeRepository();
    await repository.check("org_a", LIMIT);
    await repository.check("org_a", LIMIT);

    const decision = await repository.check("org_a", LIMIT);

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(LIMIT.seconds);
  });

  it("counts each key in its own window", async () => {
    const repository = makeRepository();
    await repository.check("org_a", LIMIT);
    await repository.check("org_a", LIMIT);
    await repository.check("org_a", LIMIT);

    await expect(repository.check("org_b", LIMIT)).resolves.toEqual({ allowed: true });
  });
}

describe("given the governance memory rate-limit repository", () => {
  contractCases(() => MemoryGovernanceRateLimitRepository.create());
});

describe("given the governance Redis rate-limit repository", () => {
  contractCases(() =>
    RedisGovernanceRateLimitRepository.create(redisRateLimiter(windowedCounter(), LIMIT)),
  );
});
