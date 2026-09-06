import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";

/**
 * The three reads that place a tenant, in the order the rule below asks them.
 *
 * A reader rather than a database client, so the rule is testable without one
 * and both processes hold the same object.
 */
export interface TenantOwnershipReader {
  /** The organization a project belongs to, or null when the id is no project. */
  tryFindProjectOrganizationId(tenantId: string): Promise<string | null>;
  /** Whether the id names an organization. */
  organizationExists(tenantId: string): Promise<boolean>;
  /** Whether the id names a user. */
  userExists(tenantId: string): Promise<boolean>;
}

/**
 * Where a tenant's data lives, for every kind of tenant the event store carries.
 *
 * A project names its owner, an organization names itself, and a user is
 * platform-level. An id that is none of the three answers null, which the
 * router refuses rather than sending to the shared instance.
 */
export class TenantDirectoryService {
  static create(reader: TenantOwnershipReader): TenantDirectoryService {
    return new TenantDirectoryService(reader);
  }

  private constructor(private readonly reader: TenantOwnershipReader) {}

  /**
   * No membership is consulted for a user: somebody can be in several
   * organizations, and picking one would put their identity history on an
   * instance chosen by accident.
   */
  async tryFindOrganizationForTenant(tenantId: string): Promise<string | null> {
    const projectOrganizationId = await this.reader.tryFindProjectOrganizationId(tenantId);
    if (projectOrganizationId) return projectOrganizationId;

    if (await this.reader.organizationExists(tenantId)) return tenantId;

    if (await this.reader.userExists(tenantId)) return PLATFORM_TENANT;

    return null;
  }
}
