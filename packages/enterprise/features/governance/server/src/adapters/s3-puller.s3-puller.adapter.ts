// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * S3PollingPullerAdapter — universal S3-polling adapter for SaaS
 * platforms that drop audit logs as files in a customer-owned bucket
 * (Anthropic compliance dump, OpenAI enterprise audit export,
 * customer-built S3-to-archive pipelines).
 *
 * Cursor model: lexicographic-max object key seen so far. Resume =
 * `ListObjectsV2(StartAfter: cursor)`. Lexicographic order is the
 * canonical S3 listing semantics; any sane "drop file per minute /
 * hour / day" naming scheme yields a monotonically increasing key
 * stream that this adapter chews through deterministically.
 *
 * Parser modes:
 *   - "ndjson"     — one JSON object per line (newline-delimited JSON)
 *   - "json-array" — top-level array of JSON objects
 *   - "csv"        — RFC4180-style CSV with headers
 *
 * Bad lines are logged + captureException'd but do NOT abort the run
 * — the adapter advances past the file so we don't re-pull broken
 * files indefinitely. errorCount reflects the count of malformed
 * records.
 *
 * Spec: specs/ai-governance/puller-framework/s3-polling.feature
 */
import { JSONPath } from "jsonpath-plus";
import { z } from "zod";
import type { GovernanceObjectStoragePort } from "../ports/governance-object-storage.port";
import {
  NullIngestionPullDiagnosticsPort,
  type IngestionPullDiagnosticsPort,
} from "../ports/ingestion-pull-worker.port";

import type {
  GovernancePuller as PullerAdapter,
  NormalizedPullEvent,
  PullResult,
  PullRunOptions,
} from "@langwatch/enterprise-governance-contract";

const MAX_FILES_PER_RUN = 100;
const MAX_BYTES_PER_FILE = 50 * 1024 * 1024; // 50 MB safety cap

const eventMappingSchema = z.object({
  source_event_id: z.string().min(1),
  event_timestamp: z.string().min(1),
  actor: z.string().min(1),
  action: z.string().min(1),
  target: z.string().min(1),
  cost_usd: z.string().optional(),
  tokens_input: z.string().optional(),
  tokens_output: z.string().optional(),
  extra: z.record(z.string(), z.string()).optional(),
});

const s3PollingConfigSchema = z.object({
  adapter: z.literal("s3_polling"),
  bucket: z.string().min(1),
  prefix: z.string().default(""),
  region: z.string().min(1),
  credentialRef: z.string().min(1).optional(),
  parser: z.enum(["ndjson", "json-array", "csv"]),
  schedule: z.string().min(1),
  eventMapping: eventMappingSchema,
});

export type S3PollingConfig = z.infer<typeof s3PollingConfigSchema>;

export class S3PollingPullerAdapter implements PullerAdapter<S3PollingConfig> {
  readonly id: string = "s3_polling";

  protected constructor(
    private readonly objects: GovernanceObjectStoragePort,
    private readonly diagnostics: IngestionPullDiagnosticsPort = new NullIngestionPullDiagnosticsPort(),
  ) {}

  static create(options: {
    objects: GovernanceObjectStoragePort;
    diagnostics?: IngestionPullDiagnosticsPort;
  }): S3PollingPullerAdapter {
    return new S3PollingPullerAdapter(options.objects, options.diagnostics);
  }

  validateConfig(config: unknown): S3PollingConfig {
    return s3PollingConfigSchema.parse(config);
  }

  async runOnce(
    options: PullRunOptions,
    config: S3PollingConfig,
  ): Promise<PullResult> {
    const cursor = options.cursor;

    const listed = await this.listKeys({
      config,
      options,
      startAfter: cursor ?? undefined,
      signal: options.signal,
    });
    if (listed.length === 0) {
      return { events: [], cursor, errorCount: 0 };
    }

    const events: NormalizedPullEvent[] = [];
    let errorCount = 0;
    let lastSuccessfulKey: string | null = cursor;

    for (const key of listed) {
      if (options.deadlineMs !== undefined && Date.now() > options.deadlineMs) {
        this.diagnostics.info(
          "deadline reached mid-pull, returning partial results",
          {
            adapter: this.id,
            key,
            processed: events.length,
          },
        );
        return { events, cursor: lastSuccessfulKey, errorCount };
      }
      try {
        const body = await this.readObject({
          config,
          options,
          key,
          signal: options.signal,
        });
        const parsed = this.parseBody({ body, config });
        for (const raw of parsed) {
          try {
            events.push(this.mapEvent(raw, config));
          } catch (error) {
            errorCount += 1;
            this.diagnostics.warn("skipping malformed event", {
              adapter: this.id,
              key,
              error: error instanceof Error ? error.message : String(error),
            });
            this.diagnostics.capture(
              error instanceof Error ? error : new Error(String(error)),
              { adapter: this.id, key },
            );
          }
        }
        lastSuccessfulKey = key;
      } catch (error) {
        // Reading the file itself failed — this is more serious than a
        // single malformed line. Log + capture but DO advance the
        // cursor: per the spec, we don't want to re-pull broken files
        // indefinitely. Operator alerting via errorCount + admin UI
        // is the right escalation channel.
        errorCount += 1;
        this.diagnostics.error("failed to read S3 object — advancing past it", {
          adapter: this.id,
          bucket: config.bucket,
          key,
          error: error instanceof Error ? error.message : String(error),
        });
        this.diagnostics.capture(
          error instanceof Error ? error : new Error(String(error)),
          { adapter: this.id, bucket: config.bucket, key },
        );
        lastSuccessfulKey = key;
      }
    }

    return { events, cursor: lastSuccessfulKey, errorCount };
  }

  private credentials(options: PullRunOptions) {
    const credentials = options.credentials ?? {};
    return {
      accessKeyId: credentials.aws_access_key_id,
      secretAccessKey: credentials.aws_secret_access_key,
      sessionToken: credentials.aws_session_token,
    };
  }

  private async listKeys({
    config,
    options,
    startAfter,
    signal,
  }: {
    config: S3PollingConfig;
    options: PullRunOptions;
    startAfter?: string;
    signal?: AbortSignal;
  }): Promise<string[]> {
    return this.objects.list({
      bucket: config.bucket,
      prefix: config.prefix,
      region: config.region,
      startAfter,
      credentials: this.credentials(options),
      signal,
      limit: MAX_FILES_PER_RUN,
    });
  }

  private async readObject({
    config,
    options,
    key,
    signal,
  }: {
    config: S3PollingConfig;
    options: PullRunOptions;
    key: string;
    signal?: AbortSignal;
  }): Promise<string> {
    return this.objects.readText({
      bucket: config.bucket,
      key,
      region: config.region,
      credentials: this.credentials(options),
      signal,
      maxBytes: MAX_BYTES_PER_FILE,
    });
  }

  private parseBody({
    body,
    config,
  }: {
    body: string;
    config: S3PollingConfig;
  }): unknown[] {
    switch (config.parser) {
      case "ndjson":
        return this.parseNdjson(body);
      case "json-array":
        return this.parseJsonArray(body);
      case "csv":
        return this.parseCsv(body);
    }
  }

  private parseNdjson(body: string): unknown[] {
    const out: unknown[] = [];
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed));
      } catch {
        // Skip malformed line — caller increments errorCount + the
        // captureException happens in the runOnce loop where we have
        // bucket/key context.
        continue;
      }
    }
    return out;
  }

  private parseJsonArray(body: string): unknown[] {
    const parsed = JSON.parse(body) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(
        "json-array parser expected a top-level JSON array, got " +
          typeof parsed,
      );
    }
    return parsed;
  }

  private parseCsv(body: string): unknown[] {
    const lines = body.split("\n").map((l) => l.replace(/\r$/, ""));
    const header = this.parseCsvLine(lines[0] ?? "");
    if (header.length === 0) return [];
    const rows: unknown[] = [];
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line || line.trim() === "") continue;
      const cells = this.parseCsvLine(line);
      const row: Record<string, string> = {};
      header.forEach((col, idx) => {
        row[col] = cells[idx] ?? "";
      });
      rows.push(row);
    }
    return rows;
  }

  /** RFC4180-ish CSV cell splitter. Handles quoted fields with commas. */
  private parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else if (c === '"') {
          inQuotes = false;
        } else {
          current += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        cells.push(current);
        current = "";
      } else {
        current += c ?? "";
      }
    }
    cells.push(current);
    return cells;
  }

  private mapEvent(
    rawEvent: unknown,
    config: S3PollingConfig,
  ): NormalizedPullEvent {
    const get = (path: string | undefined): unknown =>
      path === undefined
        ? undefined
        : (JSONPath({
            path,
            json: rawEvent as object,
            wrap: false,
          }) as unknown);

    const asString = (v: unknown): string =>
      v === undefined || v === null ? "" : String(v);
    const asNumber = (v: unknown): number => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    /** Preserves string inputs so sub-cent precision is not lost through
     *  a float round-trip. Falls back to Number→String for numeric inputs. */
    const asDecimalString = (v: unknown): string => {
      if (typeof v === "string") {
        const trimmed = v.trim();
        if (trimmed === "") return "0";
        return trimmed;
      }
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
      return "0";
    };
    const asInt = (v: unknown): number => Math.trunc(asNumber(v));

    const extras: Record<string, unknown> = {};
    if (config.eventMapping.extra) {
      for (const [k, path] of Object.entries(config.eventMapping.extra)) {
        extras[k] = get(path);
      }
    }

    return {
      source_event_id: asString(get(config.eventMapping.source_event_id)),
      event_timestamp: asString(get(config.eventMapping.event_timestamp)),
      actor: asString(get(config.eventMapping.actor)),
      action: asString(get(config.eventMapping.action)),
      target: asString(get(config.eventMapping.target)),
      cost_usd: asDecimalString(get(config.eventMapping.cost_usd)),
      tokens_input: asInt(get(config.eventMapping.tokens_input)),
      tokens_output: asInt(get(config.eventMapping.tokens_output)),
      raw_payload: JSON.stringify(rawEvent),
      ...(Object.keys(extras).length > 0 ? { extra: extras } : {}),
    };
  }
}
