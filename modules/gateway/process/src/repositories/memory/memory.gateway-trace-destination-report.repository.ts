import { Temporal } from "@langwatch/time";

import {
  GatewayTraceDestinationReportRepository,
  type TraceDestinationKeyRow,
  type TraceDestinationProjectRow,
} from "../gateway-trace-destination-report.repository.ts";
import type { MemoryGatewayStore } from "./memory.gateway.store.ts";

const NEVER_CREATED = Temporal.Instant.fromEpochMilliseconds(0);

/** The projects, keys and organizations the store holds, as the report's three reads see them. */
export class MemoryGatewayTraceDestinationReportRepository extends GatewayTraceDestinationReportRepository {
  static create(store: MemoryGatewayStore): MemoryGatewayTraceDestinationReportRepository {
    return new MemoryGatewayTraceDestinationReportRepository(store);
  }

  private constructor(private readonly store: MemoryGatewayStore) {
    super();
  }

  async findProjects(): Promise<TraceDestinationProjectRow[]> {
    const rows = this.store.projects.flatMap((project): TraceDestinationProjectRow[] => {
      const team = this.store.teams.find((candidate) => candidate.id === project.teamId);
      if (!team) return [];
      return [
        {
          id: project.id,
          kind: project.kind ?? "application",
          archivedAt: project.archivedAt ?? null,
          createdAt: project.createdAt ?? NEVER_CREATED,
          team: { organizationId: team.organizationId },
        },
      ];
    });

    return rows.toSorted(
      (left, right) =>
        left.createdAt.epochMilliseconds - right.createdAt.epochMilliseconds ||
        compareIds(left.id, right.id),
    );
  }

  async findKeyPage({
    after,
    take,
  }: {
    after: string | null;
    take: number;
  }): Promise<TraceDestinationKeyRow[]> {
    return [...this.store.virtualKeys.values()]
      .filter((key) => after === null || key.id > after)
      .toSorted((left, right) => compareIds(left.id, right.id))
      .slice(0, take)
      .map((key) => ({
        id: key.id,
        organizationId: key.organizationId,
        traceProjectId: key.traceProjectId,
        scopes: key.scopes.map((scope) => ({ scopeType: scope.scopeType, scopeId: scope.scopeId })),
      }));
  }

  async findOrganizationIds(): Promise<string[]> {
    return this.store.organizations.map((organization) => organization.id);
  }
}

/** Code-point order, as the live read's `id asc` on ASCII ids. */
function compareIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
