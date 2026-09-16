import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { Temporal, type Instant } from "@langwatch/time";

/** The wake a status assertion pins itself to. */
export function topicTestWake(epochMilliseconds: number): Instant {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds);
}

/**
 * The narrow slice of `PrismaProcessStore` actually read for `findByRef`,
 * faked so the installation test can boot `TopicApp` without a real
 * database. `nextWakeAt: null` means "not scheduled"; pass a date to fake a pending wake.
 */
export function fakeTopicSchedulePrisma(nextWakeAt: Date | null = null): PrismaClient {
  return {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: unknown) => unknown) => fn(undefined),
    processManagerInbox: {},
    processManagerInstance: {
      findUnique: async () =>
        nextWakeAt === null
          ? null
          : {
              tenantId: "project-1",
              userId: null,
              state: {},
              revision: 1,
              nextWakeAt,
              updatedAt: new Date(),
            },
    },
    processManagerOutbox: {},
    processManagerOutboxAttempt: {},
  } as unknown as PrismaClient;
}
