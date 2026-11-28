// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The kill switch lock in Postgres: when its body's signal aborts.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import { PrismaKillSwitchLockRepository } from "../prisma.kill-switch-lock.repository.ts";
import { connection } from "./prisma.kill-switch.fixtures.ts";

const TIMING = { timeoutMs: 4_000, fenceMs: 1_000 };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves with when `signal` aborted, or null when it did not within `ms`. */
function abortedWithin({ signal, ms }: { signal: AbortSignal; ms: number }) {
  return new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve(Date.now());
    });
  });
}

describe.skipIf(!connection)("the kill switch Prisma lock", () => {
  const lockOf = () => {
    if (!connection) throw new Error("no test database");
    return PrismaKillSwitchLockRepository.create(connection.client, TIMING);
  };

  describe("when a holder waited for the lock before its body ran", () => {
    /** @scenario "Key work never runs after a lock it waited for may have ended" */
    it("aborts the body's signal on the transaction's clock, counting the wait", async () => {
      const locks = lockOf();
      const key = `test-${nanoid(8)}`;
      let held = (): void => undefined;
      const holding = new Promise<void>((resolve) => (held = resolve));
      const first = locks.withLock({
        key,
        run: async () => {
          held();
          await sleep(2_000);
        },
      });
      await holding;
      const askedAt = Date.now();

      const abortedAt = await locks.withLock({
        key,
        run: ({ signal }) => abortedWithin({ signal, ms: 2_500 }),
      });
      await first;

      expect(abortedAt).not.toBeNull();
      expect((abortedAt ?? 0) - askedAt).toBeLessThan(TIMING.timeoutMs - TIMING.fenceMs + 300);
    });
  });
});
