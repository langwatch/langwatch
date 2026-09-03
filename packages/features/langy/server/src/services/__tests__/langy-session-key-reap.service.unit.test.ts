/**
 * The session-key sweep's policy, separated from the query it runs.
 *
 * Three things belong to this layer and nowhere else: which name the sweep is
 * allowed to match, that the clock is read once, and that a sweep which retired
 * nothing says nothing. The first is the safety property — the sweep holds no
 * organization, so the reserved name is the only thing between it and every
 * customer key in the product.
 *
 * Spec: packages/features/langy/specs/langy-session-key-maintenance.feature
 */
import { LANGY_SESSION_API_KEY_NAME } from "@langwatch/api-key-contract";
import { describe, expect, it, vi } from "vitest";

import { LangySessionKeyMetricsPort } from "../../ports/langy-session-key-metrics.port";
import { LangySessionKeyReapRepository } from "../../repositories/langy-session-key-reap.repository";
import { LangySessionKeyReapService } from "../langy-session-key-reap.service";

class ReapRepository extends LangySessionKeyReapRepository {
  readonly calls: Array<{ name: string; now: Date }> = [];

  constructor(private readonly count = 0) {
    super();
  }

  async revokeExpiredByName(input: { name: string; now: Date }): Promise<number> {
    this.calls.push(input);
    return this.count;
  }
}

class Metrics extends LangySessionKeyMetricsPort {
  readonly record = vi.fn();
}

function sweepWith(input: { count?: number; now?: () => Date }) {
  const repository = new ReapRepository(input.count ?? 0);
  const metrics = new Metrics();
  const service = LangySessionKeyReapService.create({
    repository,
    metrics,
    ...(input.now ? { now: input.now } : {}),
  });
  return { repository, metrics, service };
}

describe("the Langy session-key sweep", () => {
  describe("given elapsed session keys exist", () => {
    describe("when the sweep runs", () => {
      /** @scenario "The session-key sweep revokes only elapsed Langy session keys" */
      it("matches only the reserved Langy session name", async () => {
        const { repository, service } = sweepWith({ count: 1 });

        await service.reap();

        expect(repository.calls.map((call) => call.name)).toEqual([LANGY_SESSION_API_KEY_NAME]);
      });

      /** @scenario "The session-key sweep revokes only elapsed Langy session keys" */
      it("stamps the keys as of the one instant it read the clock", async () => {
        const instants = [
          new Date("2026-01-01T00:00:00.000Z"),
          new Date("2026-01-01T00:05:00.000Z"),
        ];
        const { repository, service } = sweepWith({
          count: 1,
          now: () => instants.shift() ?? new Date("2026-01-01T01:00:00.000Z"),
        });

        await service.reap();

        expect(repository.calls[0]!.now).toEqual(new Date("2026-01-01T00:00:00.000Z"));
        expect(instants).toHaveLength(1);
      });

      /** @scenario "The session-key sweep reports how many keys it retired" */
      it("answers how many keys it retired", async () => {
        const { service } = sweepWith({ count: 3 });

        await expect(service.reap()).resolves.toBe(3);
      });

      /** @scenario "The session-key sweep reports how many keys it retired" */
      it("records the count against the reaped operation", async () => {
        const { metrics, service } = sweepWith({ count: 3 });

        await service.reap();

        expect(metrics.record).toHaveBeenCalledWith({ operation: "reaped", count: 3 });
      });
    });
  });

  describe("given no session key has elapsed", () => {
    describe("when the sweep runs", () => {
      /** @scenario "A sweep that retired nothing stays quiet" */
      it("leaves the lifecycle counter untouched", async () => {
        const { metrics, service } = sweepWith({ count: 0 });

        await service.reap();

        expect(metrics.record).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a process composing the sweep", () => {
    describe("when it asks the sweep to run", () => {
      /** @scenario "A caller cannot widen which keys the sweep may touch" */
      it("offers no argument with which to name another key", () => {
        const { service } = sweepWith({});

        expect(service.reap).toHaveLength(0);
      });
    });
  });
});
