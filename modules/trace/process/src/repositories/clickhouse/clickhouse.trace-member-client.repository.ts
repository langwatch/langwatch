import { type Authorization, usableAuthorization } from "@langwatch/authorization";
import { fenceFor, type ReadResource } from "@langwatch/authorization/tenant-fence";
import {
  AuthorizedClickHouse,
  type ClickHouseQueryClient,
  expandFragment,
  type TenantScopedReader,
  type TenantScopedStatementClient,
} from "@langwatch/clickhouse-client";

/** Minimal ClickHouse client primitive; rows arrive unknown and each caller parses its own. */
export interface TraceClickHouseClient {
  query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string>;
  }): Promise<{ json(): Promise<unknown[]> }>;
}

export interface TraceClickHouseWriteClient extends TraceClickHouseClient {
  insert(input: {
    table: string;
    /**
     * Read-only on purpose: nothing behind this port mutates the batch it
     * is handed, so a caller holding a `readonly` row array (the Eventing
     * client a background process composes) satisfies it without copying.
     */
    values: readonly unknown[];
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, number>;
  }): Promise<unknown>;
}

export type TraceClickHouseResolver = (tenantId: string) => Promise<TraceClickHouseClient>;
export type TraceClickHouseWriteResolver = (
  tenantId: string,
) => Promise<TraceClickHouseWriteClient>;

export abstract class TraceClickHouse {
  abstract resolve(tenantId: string): Promise<TraceClickHouseClient>;
}

/**
 * The routed ClickHouse member, adapted to the low-level client Trace's
 * repositories ask for. One tenant per resolution, exactly as the tables' own
 * rule requires: every statement names its tenant.
 */
export class MemberTraceClickHouseClientRepository implements TraceClickHouseWriteClient {
  /** The member, as the tenant-keyed resolver every Trace repository takes. */
  static resolverFor(clickhouse: ClickHouseQueryClient): TraceClickHouseWriteResolver {
    return (tenantId) =>
      Promise.resolve(MemberTraceClickHouseClientRepository.create({ clickhouse, tenantId }));
  }

  static create(input: {
    clickhouse: ClickHouseQueryClient;
    tenantId: string;
  }): MemberTraceClickHouseClientRepository {
    return new MemberTraceClickHouseClientRepository(input.clickhouse, input.tenantId);
  }

  private constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly tenantId: string,
  ) {}

  async query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string>;
  }): Promise<{ json(): Promise<unknown[]> }> {
    const result = await this.clickhouse.query<unknown>({
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params ?? {},
      ...(input.clickhouse_settings ? { settings: input.clickhouse_settings } : {}),
    });
    return { json: async () => result.rows };
  }

  async insert(input: {
    table: string;
    values: readonly unknown[];
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, number>;
  }): Promise<unknown> {
    return this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values as readonly Record<string, unknown>[],
      ...(input.clickhouse_settings ? { settings: input.clickhouse_settings } : {}),
    });
  }
}

/** The routed ClickHouse client as the registry hands it: one tenant-keyed resolution per call. */
export class ClickHouseTraceClientsRepository extends TraceClickHouse {
  static create(clickhouse: ClickHouseQueryClient): ClickHouseTraceClientsRepository {
    return new ClickHouseTraceClientsRepository(clickhouse);
  }

  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
  }

  resolve(tenantId: string): Promise<TraceClickHouseClient> {
    return Promise.resolve(
      MemberTraceClickHouseClientRepository.create({ clickhouse: this.clickhouse, tenantId }),
    );
  }
}

/**
 * ADR-175: the reads a repository makes through a sealed proof. A converted read never names a
 * tenant: it asks for a reader bound to the proof and writes a `tenantScope` marker instead.
 */
export abstract class TraceAuthorizedReads {
  abstract reader(
    authorization: Authorization,
    options?: { reads?: ReadResource },
  ): TraceClickHouseClient;

  /**
   * A compiled filter's markers expanded into the proof's trace fence, for a read that assembles
   * its own statement (the legacy search). The fragment checks still refuse a tenant it names.
   */
  abstract expandFragment(input: {
    authorization: Authorization;
    filterWhere: { sql: string; params: Record<string, unknown> };
  }): { sql: string; params: Record<string, unknown> };
}

/** The fenced reader in the low-level shape Trace's repositories already query through. */
class ScopedTraceClickHouseClient implements TraceClickHouseClient {
  constructor(private readonly reader: TenantScopedReader) {}

  async query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string>;
  }): Promise<{ json(): Promise<unknown[]> }> {
    const result = await this.reader.query<unknown>({
      sql: input.query,
      params: input.query_params ?? {},
      ...(input.clickhouse_settings ? { settings: input.clickhouse_settings } : {}),
    });
    return { json: async () => result.rows };
  }
}

/** The routed member behind the proof-checking client: every converted read goes through here. */
export class AuthorizedTraceReadsRepository extends TraceAuthorizedReads {
  static create(input: {
    clickhouse: TenantScopedStatementClient;
    now?: () => number;
  }): AuthorizedTraceReadsRepository {
    const now = input.now ?? Date.now;
    return new AuthorizedTraceReadsRepository(
      AuthorizedClickHouse.create({ clickhouse: input.clickhouse, now }),
      now,
    );
  }

  private constructor(
    private readonly clickhouse: AuthorizedClickHouse,
    private readonly now: () => number,
  ) {
    super();
  }

  reader(
    authorization: Authorization,
    { reads = "traces" }: { reads?: ReadResource } = {},
  ): TraceClickHouseClient {
    return new ScopedTraceClickHouseClient(this.clickhouse.as(authorization, { reads }));
  }

  expandFragment({
    authorization,
    filterWhere,
  }: {
    authorization: Authorization;
    filterWhere: { sql: string; params: Record<string, unknown> };
  }): { sql: string; params: Record<string, unknown> } {
    const proof = usableAuthorization({ authorization, now: this.now() });
    return expandFragment({
      fragment: filterWhere.sql,
      queryParams: filterWhere.params,
      fence: fenceFor({ authorization: proof, reads: "traces" }),
    });
  }
}

/** A resolver a composition root hands over, as the TraceClickHouse the read repositories take. */
export class ResolverTraceClickHouse extends TraceClickHouse {
  private constructor(private readonly resolveClient: TraceClickHouseResolver) {
    super();
  }

  static create(resolveClient: TraceClickHouseResolver): ResolverTraceClickHouse {
    return new ResolverTraceClickHouse(resolveClient);
  }

  resolve(tenantId: string): Promise<TraceClickHouseClient> {
    return this.resolveClient(tenantId);
  }
}
