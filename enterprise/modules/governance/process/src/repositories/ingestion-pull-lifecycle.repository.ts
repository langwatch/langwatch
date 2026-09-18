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
  project: {
    findMany(input: {
      where: { kind: string; archivedAt: null };
      select: { id: true };
    }): Promise<{ id: string }[]>;
  };
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
    }): Promise<IngestionPullLifecycleSource[]>;
  };
};

export abstract class IngestionPullLifecycleRepository {
  abstract listForReconciliation(): Promise<IngestionPullLifecycleSource[]>;
}
