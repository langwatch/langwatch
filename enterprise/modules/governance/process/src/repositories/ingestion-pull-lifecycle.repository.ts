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
    processKeys: string[];
  }): Promise<IngestionPullLifecycleSource[]>;
}
