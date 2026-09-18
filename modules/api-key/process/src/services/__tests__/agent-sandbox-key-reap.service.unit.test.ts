/**
 * What the agent-sandbox sweep may touch: a fleet-wide predicate bounded by
 * the reserved name and the clock — the two inputs these assertions pin.
 * Spec: modules/api-key/specs/api-key.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { ApiKeyRepository } from "../../repositories/api-key.repository.ts";
import { AgentSandboxKeyReapService } from "../agent-sandbox-key-reap.service.ts";
import { Temporal, nowInstant, type Instant } from "@langwatch/time";

function repositoryDouble(count = 0) {
  const revokeExpiredByName = vi.fn(async (_input: { name: string; now: Instant }) => count);
  const repository = { revokeExpiredByName } as unknown as ApiKeyRepository;
  return { repository, revokeExpiredByName };
}

describe("the agent sandbox key sweep", () => {
  describe("given keys whose lifetime has passed", () => {
    describe("when the sweep runs", () => {
      /** @scenario "The sandbox sweep revokes only elapsed sandbox keys" */
      it("asks for the reserved sandbox name and nothing else", async () => {
        const { repository, revokeExpiredByName } = repositoryDouble(1);
        const now = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

        await AgentSandboxKeyReapService.create({ repository, now: () => now }).reap();

        // Written out rather than read from the constant the service passes: a
        // sweep pointed at another name has to fail here, which is the whole
        // reason this assertion exists.
        expect(revokeExpiredByName).toHaveBeenCalledWith({
          name: "Agent sandbox run",
          now,
        });
      });

      /** @scenario "The sandbox sweep revokes only elapsed sandbox keys" */
      it("compares against the same instant it stamps", async () => {
        const { repository, revokeExpiredByName } = repositoryDouble(1);
        const ticks = [
          Temporal.Instant.from("2026-01-01T00:00:00.000Z"),
          Temporal.Instant.from("2026-01-01T00:00:05.000Z"),
        ];
        let tick = 0;

        await AgentSandboxKeyReapService.create({
          repository,
          now: () => ticks[tick++]!,
        }).reap();

        expect(revokeExpiredByName).toHaveBeenCalledTimes(1);
        expect(tick, "the sweep read the clock more than once").toBe(1);
      });

      /** @scenario "A key whose lifetime has passed is retired" */
      it("retires a key only once its lifetime has elapsed", async () => {
        const { repository, revokeExpiredByName } = repositoryDouble(3);
        const now = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

        const count = await AgentSandboxKeyReapService.create({
          repository,
          now: () => now,
        }).reap();

        expect(count).toBe(3);
        // `lte: now` rather than `lt`, and `revokedAt: null`, are what make the
        // sweep idempotent: a key already retired is not retired again, and a
        // key expiring exactly now is not left behind for another hour.
        expect(revokeExpiredByName).toHaveBeenCalledWith({ name: "Agent sandbox run", now });
      });

      /** @scenario "The sandbox sweep reports how many keys it retired" */
      it("answers how many keys it retired", async () => {
        const { repository } = repositoryDouble(3);

        await expect(AgentSandboxKeyReapService.create({ repository }).reap()).resolves.toBe(3);
      });
    });
  });

  describe("given no caller-supplied clock", () => {
    describe("when the sweep runs", () => {
      it("reads the wall clock at the moment it sweeps", async () => {
        const { repository, revokeExpiredByName } = repositoryDouble();
        const before = nowInstant().epochMilliseconds;

        await AgentSandboxKeyReapService.create({ repository }).reap();

        const { now } = revokeExpiredByName.mock.calls[0]![0];
        expect(now.epochMilliseconds).toBeGreaterThanOrEqual(before);
        expect(now.epochMilliseconds).toBeLessThanOrEqual(nowInstant().epochMilliseconds);
      });
    });
  });
});
