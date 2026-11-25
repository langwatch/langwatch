// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldStateRead, ProjectionStoreContext } from "@langwatch/eventing";
import type {
  PrismaClient,
  ScimSsoConnectionView as ScimSsoConnectionRow,
} from "@langwatch/prisma-client/generated";

import {
  SCIM_SSO_CONNECTION_PROJECTION_VERSION,
  ScimSsoConnectionReadRepository,
  scimSsoConnectionFoldStateSchema,
  type ScimSsoConnectionFoldState,
  type ScimSsoConnectionRepository,
} from "../scim-sso-connection.repository.ts";

/**
 * The peer fold's Postgres rows (`ScimSsoConnectionView`): one per connection, the folded state as
 * JSON beside the columns the reads filter on. A row of another projection version reads as
 * undecodable, so the executor re-folds it from identity's event log.
 */
export class PrismaScimSsoConnectionRepository
  extends ScimSsoConnectionReadRepository
  implements ScimSsoConnectionRepository
{
  static create(prisma: PrismaClient): PrismaScimSsoConnectionRepository {
    return new PrismaScimSsoConnectionRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async get(aggregateId: string): Promise<FoldStateRead<ScimSsoConnectionFoldState>> {
    const { state } = await this.getWithApplied(aggregateId);
    return state ? { kind: "folded", state } : { kind: "empty" };
  }

  async getWithApplied(aggregateId: string): Promise<{
    state: ScimSsoConnectionFoldState | null;
    appliedEventIds: string[];
    miss?: "absent" | "undecodable";
  }> {
    const row = await this.prisma.scimSsoConnectionView.findUnique({ where: { id: aggregateId } });
    if (!row) return { state: null, appliedEventIds: [], miss: "absent" };
    if (row.projectionVersion !== SCIM_SSO_CONNECTION_PROJECTION_VERSION) {
      return { state: null, appliedEventIds: [], miss: "undecodable" };
    }
    return { state: rowToState(row), appliedEventIds: row.appliedEventIds };
  }

  async store(state: ScimSsoConnectionFoldState, context: ProjectionStoreContext): Promise<void> {
    const id = context.aggregateId;
    const columns = {
      organizationId: state.organizationId,
      folded: state,
      appliedEventIds: [...(context.appliedEventIds ?? [])],
      projectionVersion: SCIM_SSO_CONNECTION_PROJECTION_VERSION,
      // Business time from the facts, so a replayed row equals the row it rebuilds.
      createdAt: new Date(state.createdAtMs),
      updatedAt: new Date(state.updatedAtMs),
    };
    await this.prisma.scimSsoConnectionView.upsert({
      where: { id },
      create: { id, ...columns },
      update: columns,
    });
  }

  async findForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ScimSsoConnectionFoldState[]> {
    const rows = await this.prisma.scimSsoConnectionView.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(rowToState);
  }
}

/** The folded state this repository wrote, parsed back with identity's own state schema. */
function rowToState(row: ScimSsoConnectionRow): ScimSsoConnectionFoldState {
  return scimSsoConnectionFoldStateSchema.parse(row.folded);
}
