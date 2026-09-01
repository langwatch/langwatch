/**
 * What the agent-sandbox sweep is allowed to touch.
 *
 * The sweep holds no organization and no project — it is a fleet-wide predicate
 * over one table — so the reserved name is the only thing standing between it
 * and every customer key in the product. These assertions are about that name
 * and about the clock, because those are the two inputs a widened sweep would
 * get wrong.
 *
 * Spec: packages/features/api-key/specs/api-key.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { ApiKeyRepository } from "../../repositories/api-key.repository";
import { AgentSandboxKeyReapService } from "../agent-sandbox-key-reap.service";

function repositoryDouble(count = 0) {
  const revokeExpiredByName = vi.fn(async (_input: { name: string; now: Date }) => count);
  const repository = { revokeExpiredByName } as unknown as ApiKeyRepository;
  return { repository, revokeExpiredByName };
}

describe("the agent sandbox key sweep", () => {
  describe("given keys whose lifetime has passed", () => {
    describe("when the sweep runs", () => {
      /** @scenario "The sandbox sweep revokes only elapsed sandbox keys" */
      it("asks for the reserved sandbox name and nothing else", async () => {
        const { repository, revokeExpiredByName } = repositoryDouble(1);
        const now = new Date("2026-01-01T00:00:00.000Z");

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
        const ticks = [new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:05.000Z")];
        let tick = 0;

        await AgentSandboxKeyReapService.create({
          repository,
          now: () => ticks[tick++]!,
        }).reap();

        expect(revokeExpiredByName).toHaveBeenCalledTimes(1);
        expect(tick, "the sweep read the clock more than once").toBe(1);
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
        const before = Date.now();

        await AgentSandboxKeyReapService.create({ repository }).reap();

        const { now } = revokeExpiredByName.mock.calls[0]![0];
        expect(now.getTime()).toBeGreaterThanOrEqual(before);
        expect(now.getTime()).toBeLessThanOrEqual(Date.now());
      });
    });
  });
});
