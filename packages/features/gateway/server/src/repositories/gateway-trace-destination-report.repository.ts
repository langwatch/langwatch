/** One project, in the shape the trace-destination report classifies keys against. */
export type TraceDestinationProjectRow = Readonly<{
  id: string;
  kind: string;
  archivedAt: Date | null;
  createdAt: Date;
  team: Readonly<{ organizationId: string }>;
}>;

/** One virtual key, with the scopes the fallback rule reads. */
export type TraceDestinationKeyRow = Readonly<{
  id: string;
  organizationId: string;
  traceProjectId: string | null;
  scopes: ReadonlyArray<Readonly<{ scopeType: string; scopeId: string }>>;
}>;

/**
 * The three reads the trace-destination report makes. Keyset pagination over
 * keys rather than OFFSET, which under concurrent writes hands back the same
 * row twice or skips one.
 */
export abstract class GatewayTraceDestinationReportRepository {
  abstract findProjects(): Promise<TraceDestinationProjectRow[]>;

  abstract findKeyPage(input: {
    after: string | null;
    take: number;
  }): Promise<TraceDestinationKeyRow[]>;

  abstract findOrganizationIds(): Promise<string[]>;
}
