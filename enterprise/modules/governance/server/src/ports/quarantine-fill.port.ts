export abstract class QuarantineTenantPort {
  abstract resolveTenantId(organizationId: string): Promise<string>;
}

export abstract class QuarantineTraceActivityPort {
  abstract findSpanCountsBySource(input: {
    tenantId: string;
    sinceMs: number;
  }): Promise<Array<{ sourceId: string; spanCount: number }>>;
}
