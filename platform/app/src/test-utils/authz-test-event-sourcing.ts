import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaAuthzAuditTrailRepository } from "~/server/app-layer/authz/repositories/authz-audit-trail.prisma.repository";
import { PrismaAuthzGrantsWriteRepository } from "~/server/app-layer/authz/repositories/authz-grants-write.prisma.repository";
import { EventSourcing } from "~/server/event-sourcing";
import { createAuthzGrantsPipeline } from "~/server/event-sourcing/pipelines/authz-grants/pipeline";
import { EventStoreMemory } from "~/server/event-sourcing/stores/eventStoreMemory";
import { EventRepositoryMemory } from "~/server/event-sourcing/stores/repositories/eventRepositoryMemory";

/**
 * Compose the real grants command and projection path for a test App.
 *
 * The memory event store and queue keep this helper independent of ClickHouse
 * and Redis. Grant and audit writes still use the supplied Prisma client, so
 * callers exercise the same projection and read-your-writes behavior as the
 * application. The returned EventSourcing instance belongs to the caller and
 * must be closed with `eventSourcing.close()` after the App is discarded.
 */
export function createAuthzTestEventSourcing(
  testPrisma: PrismaClient,
): EventSourcing {
  const eventSourcing = EventSourcing.createWithStores({
    eventStore: new EventStoreMemory(new EventRepositoryMemory()),
    processRole: "worker",
  });

  eventSourcing.register(
    createAuthzGrantsPipeline({
      authzGrantsWriteStore: new PrismaAuthzGrantsWriteRepository(testPrisma),
      authzAuditTrailStore: new PrismaAuthzAuditTrailRepository(testPrisma),
    }),
  );

  return eventSourcing;
}
