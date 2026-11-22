import {
  type PersonalUsageBreakdown,
  type PersonalUsageBucket,
  type PersonalUsageQueryInput,
  type PersonalUsageSummary,
  type PersonalUsageWindow,
  personalUsageQueryInputSchema,
} from "@langwatch/enterprise-governance-contract";
import type { GatewayApi, GatewayPrincipalSpendSummary } from "@langwatch/gateway-contract";
import { Temporal } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";

const DAY_MS = 24 * 60 * 60 * 1_000;

export class DefaultGovernancePersonalUsageService {
  private constructor(
    private readonly traces: Pick<
      TraceApi,
      "getSpendSummary" | "findTopModelsByRequests" | "findDailySpend" | "findModelSpend"
    >,
    private readonly ledger: Pick<
      GatewayApi,
      "getPrincipalSpendSummary" | "findPrincipalDailySpend" | "findPrincipalModelSpend"
    >,
    private readonly clock: () => number,
  ) {}

  static create(options: {
    traces: Pick<
      TraceApi,
      "getSpendSummary" | "findTopModelsByRequests" | "findDailySpend" | "findModelSpend"
    >;
    ledger: Pick<
      GatewayApi,
      "getPrincipalSpendSummary" | "findPrincipalDailySpend" | "findPrincipalModelSpend"
    >;
    clock?: () => number;
  }): DefaultGovernancePersonalUsageService {
    return new DefaultGovernancePersonalUsageService(
      options.traces,
      options.ledger,
      options.clock ?? Date.now,
    );
  }

  async summary(input: PersonalUsageQueryInput): Promise<PersonalUsageSummary> {
    const parsed = personalUsageQueryInputSchema.parse(input);
    const window = parsed.window ?? this.currentMonthWindow();

    const [summary, [topModel]] = await Promise.all([
      this.traces.getSpendSummary({ projectId: parsed.personalProjectId, window }),
      this.traces.findTopModelsByRequests({
        projectId: parsed.personalProjectId,
        window,
        limit: 1,
      }),
    ]);
    const ingestion =
      parsed.userId && parsed.ingestionTenantId
        ? await this.tryIngestionSummary({
            tenantId: parsed.ingestionTenantId,
            userId: parsed.userId,
            window,
          })
        : null;

    const requests = summary.requestCount + (ingestion?.requestCount ?? 0);
    let mostUsed: { name: string; requests: number } | null =
      topModel && summary.requestCount > 0
        ? { name: topModel.model, requests: topModel.requests }
        : null;
    if (ingestion?.topModel && (!mostUsed || ingestion.topModel.requests > mostUsed.requests)) {
      mostUsed = ingestion.topModel;
    }

    return {
      spentUsd: summary.totalCost + (ingestion?.totalCost ?? 0),
      billedUsd: summary.billedCost + (ingestion?.totalCost ?? 0),
      requests,
      promptTokens: summary.promptTokens + (ingestion?.promptTokens ?? 0),
      completionTokens: summary.completionTokens + (ingestion?.completionTokens ?? 0),
      mostUsedModel:
        mostUsed && requests > 0
          ? {
              name: mostUsed.name,
              usagePct: Math.round((mostUsed.requests / requests) * 100),
            }
          : null,
    };
  }

  async dailyBuckets(input: PersonalUsageQueryInput): Promise<PersonalUsageBucket[]> {
    const parsed = personalUsageQueryInputSchema.parse(input);
    const window = parsed.window ?? this.lastFourteenDaysWindow();

    const rows = await this.traces.findDailySpend({
      projectId: parsed.personalProjectId,
      window,
    });
    const byDay = new Map(rows.map((row) => [row.day, { ...row }]));

    if (parsed.userId && parsed.ingestionTenantId) {
      const ingestion = await this.safeIngestionBuckets({
        tenantId: parsed.ingestionTenantId,
        userId: parsed.userId,
        window,
      });
      for (const row of ingestion) {
        const current = byDay.get(row.day) ?? {
          day: row.day,
          spentUsd: 0,
          billedUsd: 0,
          requests: 0,
        };
        current.spentUsd += row.spentUsd;
        current.billedUsd += row.billedUsd;
        current.requests += row.requests;
        byDay.set(row.day, current);
      }
    }

    return this.fillEmptyBuckets(window, byDay);
  }

  async breakdownByModel(
    input: PersonalUsageQueryInput,
    limit = 8,
  ): Promise<PersonalUsageBreakdown[]> {
    const parsed = personalUsageQueryInputSchema.parse(input);
    const window = parsed.window ?? this.currentMonthWindow();

    const rows = await this.traces.findModelSpend({
      projectId: parsed.personalProjectId,
      window,
      limit,
    });
    const aggregated = new Map(rows.map((row) => [row.label, { ...row }]));
    if (parsed.userId && parsed.ingestionTenantId) {
      const ingestion = await this.safeIngestionBreakdown({
        tenantId: parsed.ingestionTenantId,
        userId: parsed.userId,
        window,
      });
      for (const row of ingestion) {
        const current = aggregated.get(row.label) ?? {
          label: row.label,
          spentUsd: 0,
          billedUsd: 0,
          requests: 0,
        };
        current.spentUsd += row.spentUsd;
        current.billedUsd += row.billedUsd;
        current.requests += row.requests;
        aggregated.set(row.label, current);
      }
    }

    return [...aggregated.values()]
      .toSorted((left, right) => right.spentUsd - left.spentUsd)
      .slice(0, limit);
  }

  private async tryIngestionSummary(input: {
    tenantId: string;
    userId: string;
    window: PersonalUsageWindow;
  }): Promise<GatewayPrincipalSpendSummary | null> {
    try {
      return await this.ledger.getPrincipalSpendSummary({
        projectId: input.tenantId,
        userId: input.userId,
        window: input.window,
      });
    } catch {
      return null;
    }
  }

  private async safeIngestionBuckets(input: {
    tenantId: string;
    userId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageBucket[]> {
    try {
      return await this.ledger.findPrincipalDailySpend({
        projectId: input.tenantId,
        userId: input.userId,
        window: input.window,
      });
    } catch {
      return [];
    }
  }

  private async safeIngestionBreakdown(input: {
    tenantId: string;
    userId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageBreakdown[]> {
    try {
      return await this.ledger.findPrincipalModelSpend({
        projectId: input.tenantId,
        userId: input.userId,
        window: input.window,
      });
    } catch {
      return [];
    }
  }

  private currentMonthWindow(): PersonalUsageWindow {
    const nowMs = this.clock();
    const now = Temporal.Instant.fromEpochMilliseconds(nowMs).toZonedDateTimeISO("UTC");

    return {
      startMs: Temporal.PlainDateTime.from({
        year: now.year,
        month: now.month,
        day: 1,
      }).toZonedDateTime("UTC").epochMilliseconds,
      endMs: nowMs + 1,
    };
  }

  private lastFourteenDaysWindow(): PersonalUsageWindow {
    const todayMs = Temporal.Instant.fromEpochMilliseconds(this.clock())
      .toZonedDateTimeISO("UTC")
      .startOfDay().epochMilliseconds;

    return { startMs: todayMs - 13 * DAY_MS, endMs: todayMs + DAY_MS };
  }

  private fillEmptyBuckets(
    window: PersonalUsageWindow,
    data = new Map<string, PersonalUsageBucket>(),
  ): PersonalUsageBucket[] {
    const buckets: PersonalUsageBucket[] = [];
    for (let cursor = window.startMs; cursor < window.endMs; cursor += DAY_MS) {
      const day = Temporal.Instant.fromEpochMilliseconds(cursor)
        .toZonedDateTimeISO("UTC")
        .toPlainDate()
        .toString();
      buckets.push(data.get(day) ?? { day, spentUsd: 0, billedUsd: 0, requests: 0 });
    }

    return buckets;
  }
}
