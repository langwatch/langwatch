import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";
import { HandledError } from "@langwatch/handled-error";

/**
 * The three reads that place a tenant, in the order the rule below asks them. A reader rather
 * than a database client, so the rule is testable without one.
 */
export interface TenantOwnershipReader {
  /** The organization a project belongs to; throws `ProjectNotFoundError` for any other id. */
  getProjectOrganizationId(tenantId: string): Promise<string>;
  /** Whether the id names an organization. */
  organizationExists(tenantId: string): Promise<boolean>;
  /** Whether the id names a user. */
  userExists(tenantId: string): Promise<boolean>;
}

/** The organization a tenant's data lives under, or that the id names no tenant at all. */
export type TenantPlacement = { kind: "placed"; organizationId: string } | { kind: "unplaced" };

/**
 * Where a tenant's data lives, for every kind the event store carries. An id that is none of
 * project/organization/user is unplaced, which the router refuses.
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
  async getTenantPlacement(tenantId: string): Promise<TenantPlacement> {
    try {
      const organizationId = await this.reader.getProjectOrganizationId(tenantId);
      return { kind: "placed", organizationId };
    } catch (error) {
      if (!HandledError.isHandled(error) || error.code !== "project_not_found") throw error;
    }

    if (await this.reader.organizationExists(tenantId)) {
      return { kind: "placed", organizationId: tenantId };
    }

    if (await this.reader.userExists(tenantId)) {
      return { kind: "placed", organizationId: PLATFORM_TENANT };
    }

    return { kind: "unplaced" };
  }
}
