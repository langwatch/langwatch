/** Spec: specs/identity/org-account-lockout.feature */
import { NO_FAILED_ATTEMPTS } from "@langwatch/auth-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemorySignInAttemptLockRepository } from "../../repositories/memory/memory.sign-in-attempt-lock.repository.ts";
import { SignInLockReapService } from "../sign-in-lock-reap.service.ts";

const NOW = Temporal.Instant.from("2026-09-22T12:00:00Z");
const hoursBefore = (hours: number): Instant => NOW.subtract({ hours });

function seededLocks() {
  let writtenAt = NOW;
  const locks = MemorySignInAttemptLockRepository.create({ now: () => writtenAt });
  const write = async (input: {
    hash: string;
    at: Instant;
    lockedUntil?: Instant | null;
    held?: boolean;
  }) => {
    writtenAt = input.at;
    await locks.save({
      identifierHash: input.hash,
      userId: null,
      state: {
        ...NO_FAILED_ATTEMPTS,
        failedCount: 3,
        lockedUntil: input.lockedUntil ?? null,
        heldForReview: input.held ?? false,
      },
    });
  };
  return { locks, write };
}

describe("SignInLockReapService", () => {
  describe("when the daily sweep runs", () => {
    /** @scenario "Finished lock-out rows are cleared a day after they settle" */
    it("removes rows untouched for a day and keeps the recent, the locked and the held", async () => {
      const { locks, write } = seededLocks();
      await write({ hash: "settled", at: hoursBefore(30) });
      await write({ hash: "recent", at: hoursBefore(2) });
      await write({ hash: "held", at: hoursBefore(30), held: true });
      await write({
        hash: "still-locked",
        at: hoursBefore(30),
        lockedUntil: NOW.add({ hours: 1 }),
      });

      const swept = await SignInLockReapService.create({ locks, now: () => NOW }).reap();

      expect(swept).toBe(1);
      expect([...locks.rows.keys()].toSorted()).toEqual(["held", "recent", "still-locked"]);
    });
  });
});
