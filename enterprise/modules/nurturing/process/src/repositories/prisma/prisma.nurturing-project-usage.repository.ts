// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldStateRead, ProjectionStoreContext } from "@langwatch/eventing";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  type NurturingProjectUsageState,
  nurturingProjectUsageStateSchema,
} from "../../rules/nurturing-project-usage.rules.ts";
import {
  NURTURING_PROJECT_USAGE_PROJECTION_VERSION,
  type NurturingProjectUsageRepository,
} from "../nurturing-project-usage.repository.ts";

type NurturingProjectUsageDatabase = Pick<PrismaClient, "nurturingProjectUsageView">;

/**
 * The peer fold's Postgres rows (`NurturingProjectUsageView`): one per project, the folded usage as
 * JSON beside the organization placement answered. A row of another projection version reads as
 * undecodable, so the executor re-folds it from the owners' event logs.
 */
export class PrismaNurturingProjectUsageRepository
  extends PrismaRepository.for("NurturingProjectUsageView")
  implements NurturingProjectUsageRepository
{
  static create({
    prisma,
  }: Readonly<{ prisma: NurturingProjectUsageDatabase }>): PrismaNurturingProjectUsageRepository {
    return new PrismaNurturingProjectUsageRepository(prisma);
  }

  readonly #database: NurturingProjectUsageDatabase;

  private constructor(prisma: NurturingProjectUsageDatabase) {
    super(prisma);
    this.#database = prisma;
  }

  async get(aggregateId: string): Promise<FoldStateRead<NurturingProjectUsageState>> {
    const { state } = await this.getWithApplied(aggregateId);
    return state ? { kind: "folded", state } : { kind: "empty" };
  }

  async getWithApplied(aggregateId: string): Promise<{
    state: NurturingProjectUsageState | null;
    appliedEventIds: string[];
    miss?: "absent" | "undecodable";
  }> {
    const row = await this.#database.nurturingProjectUsageView.findUnique({
      where: { id: aggregateId },
    });
    if (!row) return { state: null, appliedEventIds: [], miss: "absent" };
    if (row.projectionVersion !== NURTURING_PROJECT_USAGE_PROJECTION_VERSION) {
      return { state: null, appliedEventIds: [], miss: "undecodable" };
    }
    return {
      state: nurturingProjectUsageStateSchema.parse(row.folded),
      appliedEventIds: row.appliedEventIds,
    };
  }

  /** Writes the folded columns only: the placement is the subscriber's, never the fold's. */
  async store(state: NurturingProjectUsageState, context: ProjectionStoreContext): Promise<void> {
    const id = context.aggregateId;
    const columns = {
      folded: state,
      appliedEventIds: [...(context.appliedEventIds ?? [])],
      projectionVersion: NURTURING_PROJECT_USAGE_PROJECTION_VERSION,
      // Business time from the facts, so a replayed row equals the row it rebuilds.
      updatedAt: new Date(state.LastEventOccurredAt),
    };
    await this.#database.nurturingProjectUsageView.upsert({
      where: { id },
      create: { id, ...columns },
      update: columns,
    });
  }

  async placeProject({
    projectId,
    organizationId,
  }: Readonly<{ projectId: string; organizationId: string }>): Promise<void> {
    await this.#database.nurturingProjectUsageView.updateMany({
      where: { id: projectId },
      data: { organizationId },
    });
  }

  async findForOrganization({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingProjectUsageState[]> {
    const rows = await this.#database.nurturingProjectUsageView.findMany({
      where: { organizationId, projectionVersion: NURTURING_PROJECT_USAGE_PROJECTION_VERSION },
    });
    return rows.map((row) => nurturingProjectUsageStateSchema.parse(row.folded));
  }
}
