import type { PrismaClient } from "@prisma/client";
import type { ShareResourceType } from "./repositories/share.repository";

const SHARE_LIFECYCLE_TX_TIMEOUT_MS = 30_000;
const SHARE_LIFECYCLE_TX_MAX_WAIT_MS = 10_000;

export interface ShareLifecycleLocker {
  run<T>({
    projectId,
    resourceType,
    resourceId,
    operation,
  }: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
    operation: () => Promise<T>;
  }): Promise<T>;
}

/**
 * Serializes share and share-owned pin mutations for one resource across every
 * application process. The business operation uses the normal repositories;
 * this transaction exists only to hold the namespaced Postgres advisory lock
 * until that operation finishes.
 */
export class PrismaShareLifecycleLocker implements ShareLifecycleLocker {
  constructor(private readonly prisma: PrismaClient) {}

  async run<T>({
    projectId,
    resourceType,
    resourceId,
    operation,
  }: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
    operation: () => Promise<T>;
  }): Promise<T> {
    const lockKey = `share:${projectId}:${resourceType}:${resourceId}`;
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`-- @tenancy: advisory-lock helper; key includes projectId and resource scope
SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        return operation();
      },
      {
        timeout: SHARE_LIFECYCLE_TX_TIMEOUT_MS,
        maxWait: SHARE_LIFECYCLE_TX_MAX_WAIT_MS,
      },
    );
  }
}
