// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * ActivityMonitorClickHouseRepository — facade over the three concern-scoped
 * ClickHouse repositories for the /governance admin dashboard: spend
 * rollups, per-source event listing/counting, and per-source health window
 * counts. Kept as a single class so `activityMonitor.service.ts` and its
 * tests can keep calling `this.repo.findXxx(...)` without knowing about the
 * split.
 *
 * Every query result is validated through a Zod schema before returning —
 * see `activityMonitor.clickhouse.schemas.ts` for the trust-boundary
 * rationale and the shared schemas/constants.
 *
 * Pairs with: activityMonitor.service.ts (orchestration + PG queries)
 * Spec: specs/ai-gateway/governance/folds.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type {
  PulledEventChRow,
  PushedEventChRow,
  SortDir,
  SourceEventCountChRow,
  SpendByDepartmentChRow,
  SpendByTeamSourceChRow,
  SpendByUserChRow,
  SpendOverTimeChRow,
  SpendOverTimeGroupBy,
  SpendSortField,
  SummarySpendChRow,
  WindowCountChRow,
} from "./activityMonitor.clickhouse.schemas";
import { ActivityMonitorEventsClickHouseRepository } from "./activityMonitor.events.clickhouse.repository";
import { ActivityMonitorHealthClickHouseRepository } from "./activityMonitor.health.clickhouse.repository";
import { ActivityMonitorSpendClickHouseRepository } from "./activityMonitor.spend.clickhouse.repository";

export class ActivityMonitorClickHouseRepository {
  private readonly spend = new ActivityMonitorSpendClickHouseRepository();
  private readonly events = new ActivityMonitorEventsClickHouseRepository();
  private readonly health = new ActivityMonitorHealthClickHouseRepository();

  findSummarySpend(params: {
    ch: ClickHouseClient;
    tenantId: string;
    thisStart: number;
    prevStart: number;
  }): Promise<SummarySpendChRow> {
    return this.spend.findSummarySpend(params);
  }

  findSpendByUser(params: {
    ch: ClickHouseClient;
    tenantId: string;
    windowStart: number;
    sortBy: SpendSortField;
    sortDir: SortDir;
    limit: number;
    offset: number;
  }): Promise<SpendByUserChRow[]> {
    return this.spend.findSpendByUser(params);
  }

  findSpendByDepartment(params: {
    ch: ClickHouseClient;
    tenantIds: string[];
    windowStart: number;
  }): Promise<SpendByDepartmentChRow[]> {
    return this.spend.findSpendByDepartment(params);
  }

  findSpendByTeamSource(params: {
    ch: ClickHouseClient;
    tenantId: string;
    thisStart: number;
    prevStart: number;
  }): Promise<SpendByTeamSourceChRow[]> {
    return this.spend.findSpendByTeamSource(params);
  }

  findSpendOverTime(params: {
    ch: ClickHouseClient;
    tenantId: string;
    windowStart: number;
    groupBy: SpendOverTimeGroupBy;
  }): Promise<SpendOverTimeChRow[]> {
    return this.spend.findSpendOverTime(params);
  }

  countTracedEventsBySource(params: {
    ch: ClickHouseClient;
    tenantId: string;
    sourceIds: string[];
    since: number;
  }): Promise<SourceEventCountChRow[]> {
    return this.events.countTracedEventsBySource(params);
  }

  countLoggedEventsBySource(params: {
    ch: ClickHouseClient;
    tenantId: string;
    sourceIds: string[];
    since: number;
  }): Promise<SourceEventCountChRow[]> {
    return this.events.countLoggedEventsBySource(params);
  }

  countPulledEventsBySource(params: {
    ch: ClickHouseClient;
    tenantId: string;
    sourceIds: string[];
    since: number;
  }): Promise<SourceEventCountChRow[]> {
    return this.events.countPulledEventsBySource(params);
  }

  findPushedEventsForSource(params: {
    ch: ClickHouseClient;
    tenantId: string;
    sourceId: string;
    beforeMs: number;
    limit: number;
  }): Promise<PushedEventChRow[]> {
    return this.events.findPushedEventsForSource(params);
  }

  findPulledEventsForSource(params: {
    ch: ClickHouseClient;
    tenantId: string;
    sourceId: string;
    beforeMs: number;
    limit: number;
  }): Promise<PulledEventChRow[]> {
    return this.events.findPulledEventsForSource(params);
  }

  findTracedEventWindowCounts(params: {
    ch: ClickHouseClient;
    tenantId: string;
    sourceId: string;
    since24h: number;
    since7d: number;
    since30d: number;
  }): Promise<WindowCountChRow | undefined> {
    return this.health.findTracedEventWindowCounts(params);
  }

  findLoggedEventWindowCounts(params: {
    ch: ClickHouseClient;
    tenantId: string;
    sourceId: string;
    since24h: number;
    since7d: number;
    since30d: number;
  }): Promise<WindowCountChRow | undefined> {
    return this.health.findLoggedEventWindowCounts(params);
  }

  findPulledEventWindowCounts(params: {
    ch: ClickHouseClient;
    tenantId: string;
    sourceId: string;
    since24h: number;
    since7d: number;
    since30d: number;
  }): Promise<WindowCountChRow | undefined> {
    return this.health.findPulledEventWindowCounts(params);
  }
}
