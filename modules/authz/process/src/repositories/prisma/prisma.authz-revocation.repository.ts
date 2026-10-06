import { toDate } from "@langwatch/time";

import {
  type AuthzRevocationMark,
  AuthzRevocationRepository,
} from "../authz-revocation.repository.ts";

/** The one write this repository performs, and no other. */
export type RevocationDatabase = {
  grant: {
    updateMany(args: unknown): Promise<unknown>;
  };
};

export type PrismaAuthzRevocationRepositoryOptions = {
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
}
