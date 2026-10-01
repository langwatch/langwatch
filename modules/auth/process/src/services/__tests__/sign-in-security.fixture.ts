import type { LockoutPolicy, SessionBound } from "@langwatch/auth-contract";
import type { Instant } from "@langwatch/time";

import { MemorySignInAttemptLockRepository } from "../../repositories/memory/memory.sign-in-attempt-lock.repository.ts";
import { MemorySignInSecuritySettingsRepository } from "../../repositories/memory/memory.sign-in-security-settings.repository.ts";
import { SessionBoundService } from "../session-bound.service.ts";
import { SignInLockoutService, type SignInLockoutEvidence } from "../sign-in-lockout.service.ts";

/** What the evidence port was told, as rows a test can read back. */
export type RecordedEvidence = {
  locked: { userId: string | null; failedCount: number; consecutiveLockouts: number }[];
  escalated: { userId: string | null; consecutiveLockouts: number }[];
};

/**
 * The sign-in security services over their own memory twins - the same
 * repositories a process booted without a database composes, so a test here
 * exercises the shipped code rather than a stand-in for it.
 */
export function signInSecurityFixture({ now }: { now: () => Instant }) {
  const locks = MemorySignInAttemptLockRepository.create({ now });
  const settings = MemorySignInSecuritySettingsRepository.create();
  const accounts = new Map<string, string>();
  const touched: { sessionId: string; at: Instant }[] = [];
  const recorded: RecordedEvidence = { locked: [], escalated: [] };

  const evidence: SignInLockoutEvidence = {
    locked: async (entry) => {
      recorded.locked.push(entry);
    },
    escalated: async (entry) => {
      recorded.escalated.push(entry);
    },
  };

  return {
    locks,
    settings,
    recorded,
    touched,
    /** Puts an organization's rule in place and joins whoever belongs to it. */
    organization: async ({
      id,
      lockout,
      sessionBound,
      members = [],
    }: {
      id: string;
      lockout: LockoutPolicy;
      sessionBound: SessionBound;
      members?: string[];
    }) => {
      await settings.save({ organizationId: id, rule: { lockout, sessionBound } });
      for (const userId of members) settings.join({ userId, organizationId: id });
    },
    /** Gives an address an account, which an unknown address never gets. */
    account: ({ identifier, userId }: { identifier: string; userId: string }) => {
      accounts.set(identifier, userId);
      return userId;
    },
    lockout: SignInLockoutService.create({
      locks,
      settings,
      directory: {
        findUserIdFor: async ({ identifier }) => accounts.get(identifier) ?? null,
      },
      evidence,
      // A test hash, so a case can assert on what was stored without the
      // deployment secret the real hasher refuses to work without.
      hashIdentifier: (key) => `keyed:${key}`,
      now,
    }),
    sessionBound: SessionBoundService.create({
      settings,
      activity: {
        touch: async (entry) => {
          touched.push(entry);
        },
      },
      now,
    }),
  };
}
