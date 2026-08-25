import {
  GovernancePersonalUsageService,
  type PersonalUsageBreakdown,
  type PersonalUsageBucket,
  type PersonalUsageQueryInput,
  type PersonalUsageSummary,
  type PersonalUsageWindow,
  personalUsageQueryInputSchema,
} from "@langwatch/enterprise-governance-contract";
import type {
  IngestionPrincipalSummaryRow,
  PersonalUsageReaderPort,
} from "../ports/personal-usage.port";

const DAY_MS = 24 * 60 * 60 * 1_000;

export class DefaultGovernancePersonalUsageService extends GovernancePersonalUsageService {
  private constructor(
    private readonly reader: PersonalUsageReaderPort | undefined,
    private readonly clock: () => number,
  ) {
    super();
  }

  static create(options: {
    reader?: PersonalUsageReaderPort;
    clock?: () => number;
  }): DefaultGovernancePersonalUsageService {
    return new DefaultGovernancePersonalUsageService(
      options.reader,
      options.clock ?? Date.now,
    );
  }

  async summary(input: PersonalUsageQueryInput): Promise<PersonalUsageSummary> {
    const parsed = personalUsageQueryInputSchema.parse(input);
    const window = parsed.window ?? this.currentMonthWindow();
    if (!this.reader) return this.emptySummary();

    const [summary, topModel] = await Promise.all([
      this.reader.findSummary({ tenantId: parsed.personalProjectId, window }),
      this.reader.tryFindTopModel({ tenantId: parsed.personalProjectId, window }),
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
    if (
      ingestion?.topModel &&
      (!mostUsed || ingestion.topModel.requests > mostUsed.requests)
    ) {
      mostUsed = ingestion.topModel;
    }

    return {
      spentUsd: summary.totalCost + (ingestion?.totalCost ?? 0),
      billedUsd: summary.billedCost + (ingestion?.totalCost ?? 0),
      requests,
      promptTokens: summary.promptTokens + (ingestion?.promptTokens ?? 0),
      completionTokens:
        summary.completionTokens + (ingestion?.completionTokens ?? 0),
      mostUsedModel:
        mostUsed && requests > 0
          ? {
              name: mostUsed.name,
              usagePct: Math.round((mostUsed.requests / requests) * 100),
            }
          : null,
    };
  }

  async dailyBuckets(
    input: PersonalUsageQueryInput,
  ): Promise<PersonalUsageBucket[]> {
    const parsed = personalUsageQueryInputSchema.parse(input);
    const window = parsed.window ?? this.lastFourteenDaysWindow();
    if (!this.reader) return this.fillEmptyBuckets(window);

    const rows = await this.reader.findDailyBuckets({
      tenantId: parsed.personalProjectId,
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
    if (!this.reader) return [];

    const rows = await this.reader.findModelBreakdown({
      tenantId: parsed.personalProjectId,
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
      .sort((left, right) => right.spentUsd - left.spentUsd)
      .slice(0, limit);
  }

  private async tryIngestionSummary(input: {
    tenantId: string;
    userId: string;
    window: PersonalUsageWindow;
  }): Promise<IngestionPrincipalSummaryRow | null> {
    try {
      return (
        (await this.reader?.tryFindIngestionPrincipalSummary(input)) ?? null
      );
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
      return (await this.reader?.findIngestionPrincipalBuckets(input)) ?? [];
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
      return (await this.reader?.findIngestionPrincipalBreakdown(input)) ?? [];
    } catch {
      return [];
    }
  }

  private currentMonthWindow(): PersonalUsageWindow {
    const now = new Date(this.clock());
    return {
      startMs: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      endMs: now.getTime() + 1,
    };
  }

  private lastFourteenDaysWindow(): PersonalUsageWindow {
    const now = new Date(this.clock());
    const todayMs = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    return { startMs: todayMs - 13 * DAY_MS, endMs: todayMs + DAY_MS };
  }

  private fillEmptyBuckets(
    window: PersonalUsageWindow,
    data = new Map<string, PersonalUsageBucket>(),
  ): PersonalUsageBucket[] {
    const buckets: PersonalUsageBucket[] = [];
    for (let cursor = window.startMs; cursor < window.endMs; cursor += DAY_MS) {
      const day = new Date(cursor).toISOString().slice(0, 10);
      buckets.push(
        data.get(day) ?? { day, spentUsd: 0, billedUsd: 0, requests: 0 },
      );
    }
    return buckets;
  }

  private emptySummary(): PersonalUsageSummary {
    return {
      spentUsd: 0,
      billedUsd: 0,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      mostUsedModel: null,
    };
  }
}
