// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  IngestionSourceHealthRow,
  RecentAnomalyRow,
} from "@langwatch/enterprise-governance-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
/**
 * PrismaActivityMonitorRepository - the activity monitor's own Postgres rows: sources,
 * anomalies and departments. Trace spend is trace's, read through TraceApi by the service.
 * Spec: specs/ai-gateway/governance/folds.feature
 */
import { nowInstant, toDate } from "@langwatch/time";

import type {
  DepartmentDirectory,
  SourceTeam,
} from "../../features/cost/rules/activity-monitor-spend.rules.ts";
import type {
  ActivityMonitorRepository,
  AnomalyBreakdown,
} from "../activity-monitor.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type ActivityMonitorDatabase = Pick<
  PrismaClient,
  "anomalyAlert" | "department" | "ingestionSource" | "organizationUser" | "project"
>;

export class PrismaActivityMonitorRepository implements ActivityMonitorRepository {
  private constructor(private readonly prisma: ActivityMonitorDatabase) {}

  static create(options: { prisma: ActivityMonitorDatabase }): PrismaActivityMonitorRepository {
    return new PrismaActivityMonitorRepository(options.prisma);
  }

  async sourceDataCoverage(input: {
    organizationId: string;
    sourceId: string;
    windowDays: number;
  }): Promise<{
    health: "healthy" | "unhealthy";
    consecutiveFailures: number;
    lastSuccessfulPullIso: string | null;
    days: { dayStartIso: string; covered: boolean }[];
  }> {
    const source = await this.prisma.ingestionSource.findFirstOrThrow({
      where: { id: input.sourceId, organizationId: input.organizationId },
      select: { errorCount: true, lastSuccessAt: true },
    });
    const today = nowInstant().toZonedDateTimeISO("UTC").startOfDay();
    const days = Array.from({ length: input.windowDays }, (_, index) => {
      const day = toDate(today.subtract({ days: input.windowDays - index - 1 }));
      return {
        dayStartIso: day.toISOString(),
        covered: source.lastSuccessAt !== null && day.getTime() <= source.lastSuccessAt.getTime(),
      };
    });
    return {
      health: source.errorCount >= 3 ? "unhealthy" : "healthy",
      consecutiveFailures: source.errorCount,
      lastSuccessfulPullIso: source.lastSuccessAt?.toISOString() ?? null,
      days,
    };
  }

  async getOpenAnomalyBreakdown(input: { organizationId: string }): Promise<AnomalyBreakdown> {
    const grouped = await this.prisma.anomalyAlert.groupBy({
      by: ["severity"],
      where: { organizationId: input.organizationId, state: "open" },
      _count: { _all: true },
    });
    const breakdown = { critical: 0, warning: 0, info: 0 };
    for (const row of grouped) {
      const sev = row.severity as keyof typeof breakdown;
      if (sev in breakdown) breakdown[sev] = row._count._all;
    }
    return breakdown;
  }

  /**
   * A member's own department, and separately the first non-personal team department they
   * inherit, keyed by email (the `langwatch.user_id` attribute). Archived departments are
   * absent from `activeDepartmentNames`, so they roll up as Unassigned without a backfill.
   */
  async getDepartmentDirectory(input: { organizationId: string }): Promise<DepartmentDirectory> {
    const { organizationId } = input;
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId }, archivedAt: null },
      select: { id: true, departmentId: true },
    });
    const members = await this.prisma.organizationUser.findMany({
      where: { organizationId },
      select: {
        departmentId: true,
        user: {
          select: {
            email: true,
            teamMemberships: {
              where: {
                team: { organizationId, isPersonal: false, departmentId: { not: null } },
              },
              select: { team: { select: { departmentId: true } } },
            },
          },
        },
      },
    });
    const departments = await this.prisma.department.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, name: true },
    });

    const userDepartmentByEmail = new Map<string, string | null>();
    const userTeamDepartmentByEmail = new Map<string, string | null>();
    for (const m of members) {
      const email = m.user.email;
      if (!email) continue;
      userDepartmentByEmail.set(email, m.departmentId);
      const inherited = m.user.teamMemberships.find((tm) => tm.team.departmentId)?.team
        .departmentId;
      userTeamDepartmentByEmail.set(email, inherited ?? null);
    }
    return {
      projectDepartmentById: new Map(projects.map((p) => [p.id, p.departmentId] as const)),
      userDepartmentByEmail,
      userTeamDepartmentByEmail,
      activeDepartmentNames: new Map(departments.map((d) => [d.id, d.name] as const)),
    };
  }

  async findSourceTeams(input: {
    organizationId: string;
    sourceIds: readonly string[];
  }): Promise<{ sourceId: string; team: SourceTeam }[]> {
    if (input.sourceIds.length === 0) return [];
    const sources = await this.prisma.ingestionSource.findMany({
      where: { id: { in: [...input.sourceIds] }, organizationId: input.organizationId },
      select: { id: true, team: { select: { id: true, name: true } } },
    });
    return sources.map((s) => ({ sourceId: s.id, team: s.team ?? null }));
  }

  async findActiveSources(input: {
    organizationId: string;
  }): Promise<Omit<IngestionSourceHealthRow, "eventsLast24h">[]> {
    const sources = await this.prisma.ingestionSource.findMany({
      where: { organizationId: input.organizationId, archivedAt: null },
      orderBy: { name: "asc" },
    });
    return sources.map((src) => ({
      id: src.id,
      name: src.name,
      sourceType: src.sourceType,
      status: src.status,
      lastEventIso: src.lastEventAt?.toISOString() ?? null,
    }));
  }

  /** Alerts newest first; an organisation with none reads `[]`. */
  async recentAnomalies(input: {
    organizationId: string;
    limit?: number;
  }): Promise<RecentAnomalyRow[]> {
    const limit = input.limit ?? 50;
    const rows = await this.prisma.anomalyAlert.findMany({
      where: { organizationId: input.organizationId },
      orderBy: { detectedAt: "desc" },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      ruleId: row.ruleId,
      ruleName: row.ruleName,
      ruleType: row.ruleType,
      severity: row.severity as "critical" | "warning" | "info",
      triggerWindowStartIso: row.triggerWindowStart.toISOString(),
      triggerWindowEndIso: row.triggerWindowEnd.toISOString(),
      triggerSpendUsd: row.triggerSpendUsd ? Number(row.triggerSpendUsd.toString()) : null,
      triggerEventCount: row.triggerEventCount,
      detectedAtIso: row.detectedAt.toISOString(),
      state: row.state,
      currentState: row.state as "open" | "acknowledged" | "resolved",
      detail: row.detail as Record<string, unknown>,
      // Back-compat aliases for the existing /governance dashboard.
      rule: row.ruleName,
      sourceLabel: PrismaActivityMonitorRepository.extractSourceLabel(row.detail),
    }));
  }

  private static extractSourceLabel(detail: unknown): string {
    const d = (detail as Record<string, unknown>) ?? {};
    if (typeof d.sourceLabel === "string") return d.sourceLabel;
    if (typeof d.source === "string") return d.source;
    return "";
  }
}
