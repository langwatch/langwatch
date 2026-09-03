export type IngestionPullLifecycleSource = {
  id: string;
  organizationId: string;
  status: string;
  pullSchedule: string | null;
  pollerCursor: unknown;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type IngestionPullLifecycleDatabase = {
  project: {
    findMany(input: {
      where: { kind: string; archivedAt: null };
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
  processManagerInstance: {
    findMany(input: {
      where: { processName: string; projectId: { in: string[] } };
      select: { processKey: true };
    }): Promise<Array<{ processKey: string }>>;
  };
  ingestionSource: {
    findMany(input: {
      where: {
        OR: Array<{ pullSchedule: { not: null } } | { id: { in: string[] } }>;
      };
    }): Promise<IngestionPullLifecycleSource[]>;
  };
};

export abstract class IngestionPullLifecycleRepository {
  abstract listForReconciliation(): Promise<IngestionPullLifecycleSource[]>;
}

export abstract class IngestionPullTenantPort {
  abstract resolveTenantId(organizationId: string): Promise<string>;
}

export abstract class IngestionPullLifecycleCommandPort {
  abstract configure(input: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    cron: string;
    configVersion: string;
    cursor: string | null;
  }): Promise<void>;

  abstract disable(input: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    configVersion: string;
  }): Promise<void>;
}
