// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  FoldProjectionStore,
  FoldStateRead,
  ProjectionStoreContext,
} from "@langwatch/eventing";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  type NurturingProjectUsageState,
  nurturingProjectUsageStateSchema,
} from "../../rules/nurturing-project-usage.rules.ts";
import {
  NURTURING_PROJECT_USAGE_PROJECTION_VERSION,
  type NurturingProjectUsageOwner,
  type NurturingProjectUsageRepository,
  projectUsageRowId,
} from "../nurturing-project-usage.repository.ts";

type NurturingProjectUsageDatabase = Pick<PrismaClient, "nurturingProjectUsageView">;

/**
 * The peer folds' Postgres rows (`NurturingProjectUsageView`): one per owner and project, the
 * folded usage as JSON beside the project and the organization placement answered. A row of
 * another projection version reads as undecodable, so the executor re-folds it from the owner's log.
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

  forOwner(owner: NurturingProjectUsageOwner): FoldProjectionStore<NurturingProjectUsageState> {
    const database = this.#database;
    const getWithApplied = async (
      key: string,
    ): Promise<{
      state: NurturingProjectUsageState | null;
      appliedEventIds: string[];
      miss?: "absent" | "undecodable";
    }> => {
      const row = await database.nurturingProjectUsageView.findUnique({
        where: { id: projectUsageRowId(owner, key) },
      });
      if (!row) return { state: null, appliedEventIds: [], miss: "absent" };
      if (row.projectionVersion !== NURTURING_PROJECT_USAGE_PROJECTION_VERSION) {
        return { state: null, appliedEventIds: [], miss: "undecodable" };
      }
      return {
        state: nurturingProjectUsageStateSchema.parse(row.folded),
        appliedEventIds: row.appliedEventIds,
      };
    };
    return {
      getWithApplied,
      async get(key: string): Promise<FoldStateRead<NurturingProjectUsageState>> {
        const { state } = await getWithApplied(key);
        return state ? { kind: "folded", state } : { kind: "empty" };
      },
      /** Writes the folded columns only: the placement is the subscriber's, never the fold's. */
      async store(state: NurturingProjectUsageState, context: ProjectionStoreContext) {
        const projectId = context.key ?? context.aggregateId;
        const id = projectUsageRowId(owner, projectId);
        const columns = {
          projectId,
          folded: state,
          appliedEventIds: [...(context.appliedEventIds ?? [])],
          projectionVersion: NURTURING_PROJECT_USAGE_PROJECTION_VERSION,
          // Business time from the facts, so a replayed row equals the row it rebuilds.
          updatedAt: new Date(state.LastEventOccurredAt),
        };
        await database.nurturingProjectUsageView.upsert({
          where: { id },
          create: { id, ...columns },
          update: columns,
        });
      },
    };
  }

  async placeProject({
    projectId,
    organizationId,
  }: Readonly<{ projectId: string; organizationId: string }>): Promise<void> {
    await this.#database.nurturingProjectUsageView.updateMany({
      where: { projectId },
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
