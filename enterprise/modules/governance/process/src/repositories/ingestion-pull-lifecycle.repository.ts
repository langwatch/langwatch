import type { Instant } from "@langwatch/time";

export type IngestionPullLifecycleSource = {
  id: string;
  organizationId: string;
  status: string;
  pullSchedule: string | null;
  pollerCursor: unknown;
  updatedAt: Instant;
  archivedAt: Instant | null;
};

export type IngestionPullLifecycleDatabase = {
  processManagerInstance: {
    findMany(input: {
      where: { processName: string; projectId: { in: string[] } };
      select: { processKey: true };
    }): Promise<{ processKey: string }[]>;
  };
  ingestionSource: {
    findMany(input: {
      where: {
        OR: ({ pullSchedule: { not: null } } | { id: { in: string[] } })[];
      };
    }): Promise<
      (Omit<IngestionPullLifecycleSource, "updatedAt" | "archivedAt"> & {
        updatedAt: Date;
        archivedAt: Date | null;
      })[]
    >;
  };
};

export abstract class IngestionPullLifecycleRepository {
  abstract findForReconciliation(input: {
    governanceProjectIds: string[];
  }): Promise<IngestionPullLifecycleSource[]>;
}
