export type OtlpAnyValue = {
  stringValue?: string | null;
  intValue?: string | number | null;
  doubleValue?: number | null;
  boolValue?: boolean | null;
};
export type OtlpKeyValue = { key?: string; value?: OtlpAnyValue };
export type OtlpFixed64 = string | number | { low: number; high: number };
export type OtlpLogRecord = {
  attributes?: OtlpKeyValue[];
  timeUnixNano?: OtlpFixed64;
};
export type OtlpLogsRequest = {
  resourceLogs?: Array<{
    resource?: { attributes?: OtlpKeyValue[] };
    scopeLogs?: Array<{ logRecords?: OtlpLogRecord[] }>;
  }>;
};
export type CanonicalCostEvent = {
  costUsd: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  requestId: string;
  occurredAt: Date;
  userEmail: string | null;
  teamIdHint: string | null;
  raw: Record<string, unknown>;
};

const FIELD = {
  costUsd: "langwatch.cost.usd",
  requestId: "langwatch.request_id",
  model: "langwatch.model",
  inputTokens: "langwatch.input_tokens",
  outputTokens: "langwatch.output_tokens",
  cacheReadTokens: "langwatch.cache_read_tokens",
  cacheCreationTokens: "langwatch.cache_creation_tokens",
  principalEmail: "langwatch.principal.email",
  teamIdHint: "langwatch.team.id_hint",
} as const;

export class CanonicalCostExtractorService {
  static create(): CanonicalCostExtractorService {
    return new CanonicalCostExtractorService();
  }

  extract(request: OtlpLogsRequest): CanonicalCostEvent[] {
    const events: CanonicalCostEvent[] = [];
    for (const resourceLog of request.resourceLogs ?? []) {
      const resource = this.merge(resourceLog.resource?.attributes ?? []);
      for (const scopeLog of resourceLog.scopeLogs ?? []) {
        for (const record of scopeLog.logRecords ?? []) {
          const parsed = this.tryParse(record, resource);
          if (parsed) events.push(parsed);
        }
      }
    }
    return events;
  }

  private merge(values: OtlpKeyValue[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const item of values) {
      if (!item.key || !item.value) continue;
      const value = item.value;
      if (value.stringValue !== undefined) result[item.key] = value.stringValue;
      else if (value.intValue !== undefined) {
        result[item.key] =
          typeof value.intValue === "string" ? Number(value.intValue) : value.intValue;
      } else if (value.doubleValue !== undefined) result[item.key] = value.doubleValue;
      else if (value.boolValue !== undefined) result[item.key] = value.boolValue;
    }
    return result;
  }

  private tryParse(
    record: OtlpLogRecord,
    resource: Record<string, unknown>,
  ): CanonicalCostEvent | null {
    const merged = { ...resource, ...this.merge(record.attributes ?? []) };
    const requestId = this.tryString(merged[FIELD.requestId]);
    const costUsd = this.tryCost(merged[FIELD.costUsd]);
    if (!requestId || costUsd === null) return null;
    return {
      costUsd,
      model: this.tryString(merged[FIELD.model]) ?? "unknown",
      inputTokens: this.number(merged[FIELD.inputTokens]),
      outputTokens: this.number(merged[FIELD.outputTokens]),
      cacheReadTokens: this.number(merged[FIELD.cacheReadTokens]),
      cacheCreationTokens: this.number(merged[FIELD.cacheCreationTokens]),
      requestId,
      occurredAt: this.date(record.timeUnixNano),
      userEmail: this.tryString(merged[FIELD.principalEmail]),
      teamIdHint: this.tryString(merged[FIELD.teamIdHint]),
      raw: merged,
    };
  }

  private tryString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private number(value: unknown): number {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private tryCost(value: unknown): string | null {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value !== "string" || value.trim() === "") return null;
    return Number.isFinite(Number(value)) ? value.trim() : null;
  }

  private date(value: OtlpFixed64 | undefined): Date {
    if (value === undefined) return new Date();
    let nanos: bigint;
    if (typeof value === "string") {
      nanos = BigInt(value);
    } else if (typeof value === "number") {
      nanos = BigInt(Math.floor(value));
    } else {
      nanos = (BigInt(value.high >>> 0) << 32n) | BigInt(value.low >>> 0);
    }
    return new Date(Number(nanos / 1_000_000n));
  }
}
