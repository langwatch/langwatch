import { describe, expect, it } from "vitest";

import { MemoryWebhookDispatchCapRepository } from "../memory/memory.webhook-dispatch-cap.repository.ts";
import {
  RedisWebhookDispatchCapRepository,
  type WebhookDispatchCounter,
} from "../redis/redis.webhook-dispatch-cap.repository.ts";

/**
 * Spec: modules/webhook/specs/webhook-egress.feature
 * The counter under the key the tenant is billed by; both twins answer alike.
 */

class FakeCounter implements WebhookDispatchCounter {
  readonly counts = new Map<string, number>();
  readonly expiries: { key: string; seconds: number }[] = [];

  async incr(key: string): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }

  async expire(key: string, seconds: number): Promise<void> {
    this.expiries.push({ key, seconds });
  }

  async ttl(): Promise<number> {
    return 600;
  }
}

describe("RedisWebhookDispatchCapRepository", () => {
  /** @scenario "The cap counts one attempt per dispatch under the key the tenant is billed by" */
  /** @scenario "The dispatch cap is counted where the whole fleet can see it" */
  it("counts under main's key, opening the window once", async () => {
    const counter = new FakeCounter();
    const repository = RedisWebhookDispatchCapRepository.create({ connection: counter });

    await repository.countAttempt({ scopeId: "proj_1", windowSeconds: 3600, max: 1000 });
    await repository.countAttempt({ scopeId: "proj_1", windowSeconds: 3600, max: 1000 });

    expect([...counter.counts]).toEqual([["langwatch:ratelimit:webhook-dispatch:proj_1", 2]]);
    expect(counter.expiries).toEqual([
      { key: "langwatch:ratelimit:webhook-dispatch:proj_1", seconds: 3600 },
    ]);
  });

  it("refuses past the max and reports when the window ends", async () => {
    const repository = RedisWebhookDispatchCapRepository.create({ connection: new FakeCounter() });

    const first = await repository.countAttempt({ scopeId: "proj_1", windowSeconds: 3600, max: 1 });
    const second = await repository.countAttempt({
      scopeId: "proj_1",
      windowSeconds: 3600,
      max: 1,
    });

    expect(first).toMatchObject({ allowed: true, remaining: 0 });
    expect(second).toMatchObject({ allowed: false, remaining: 0 });
    expect(second.resetAt).toBeGreaterThan(Date.now());
  });
});

describe("MemoryWebhookDispatchCapRepository", () => {
  it("counts per scope and refuses past the max", async () => {
    const repository = MemoryWebhookDispatchCapRepository.create();

    const first = await repository.countAttempt({ scopeId: "a", windowSeconds: 3600, max: 1 });
    const second = await repository.countAttempt({ scopeId: "a", windowSeconds: 3600, max: 1 });
    const other = await repository.countAttempt({ scopeId: "b", windowSeconds: 3600, max: 1 });

    expect([first.allowed, second.allowed, other.allowed]).toEqual([true, false, true]);
  });
});
