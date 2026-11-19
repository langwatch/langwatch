import { toDate } from "@langwatch/time";

import {
  type AuthzRevocationMark,
  AuthzRevocationRepository,
  type AuthzRoleDeletionMark,
} from "../authz-revocation.repository.ts";
import { SYSTEM_API_KEY_ROLE_KIND } from "../eventing/eventing.authz-read.mapper.ts";

/** The two writes this repository performs, and no other. */
type RevocationDatabase = {
  grant: {
    updateMany(args: unknown): Promise<unknown>;
  };
  role: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

type PrismaAuthzRevocationRepositoryOptions = {
  database: RevocationDatabase;
};

/** Marks the Grant head rows; `revokedAt: null` keeps the first mark the durable one. */
export class PrismaAuthzRevocationRepository extends AuthzRevocationRepository {
  static create(options: PrismaAuthzRevocationRepositoryOptions): PrismaAuthzRevocationRepository {
    return new PrismaAuthzRevocationRepository(options.database);
  }

  private constructor(private readonly database: RevocationDatabase) {
    super();
  }

  protected async markRevoked({
    organizationId,
    grantIds,
    revokedAt,
    revokedReason,
  }: AuthzRevocationMark): Promise<void> {
    await this.database.grant.updateMany({
      where: { organizationId, id: { in: grantIds }, revokedAt: null },
      data: { revokedAt: toDate(revokedAt), revokedReason },
    });
  }

  protected async markRoleDeleted({
    organizationId,
    roleId,
    deletedAt,
  }: AuthzRoleDeletionMark): Promise<number> {
    const at = toDate(deletedAt);
    const { count } = await this.database.role.updateMany({
      where: {
        id: roleId,
        organizationId,
        kind: SYSTEM_API_KEY_ROLE_KIND,
        deletedAt: null,
        occurredAt: { lte: at },
      },
      data: { deletedAt: at, occurredAt: at },
    });
    return count;
  }
}
