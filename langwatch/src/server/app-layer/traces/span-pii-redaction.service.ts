import { env } from "~/env.mjs";
import {
  batchPresidioClearPII as defaultBatchPresidioClearPII,
  googleDLPClearPII,
  type PIICheckOptions,
} from "~/server/background/workers/collector/piiCheck";
import { createLogger } from "~/utils/logger/server";
import {
  DEFAULT_PII_REDACTION_LEVEL,
  type PIIRedactionLevel,
} from "../../event-sourcing/pipelines/trace-processing/schemas/commands";
import type {
  OtlpAnyValue,
  OtlpKeyValue,
  OtlpResource,
  OtlpSpan,
} from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import { ATTR_KEYS } from "./canonicalisation/extractors/_constants";

/**
 * Maximum attribute value length (in characters) for PII redaction.
 * Matches the Presidio truncation limit in piiCheck.ts — values beyond this
 * are only partially scanned anyway, so skip the expensive call entirely.
 */
export const DEFAULT_PII_REDACTION_MAX_ATTRIBUTE_LENGTH = 250_000;

/**
 * Function type for batch PII clearing.
 * Returns an array where each element is the anonymized text (or null if unchanged).
 */
export type BatchClearPIIFunction = (
  texts: string[],
  options: PIICheckOptions,
) => Promise<(string | null)[]>;

/**
 * Dependencies for OtlpSpanPiiRedactionService that can be injected for testing.
 */
export interface OtlpSpanPiiRedactionServiceDependencies {
  /** Batch function to clear PII from multiple text values in one call */
  batchClearPII: BatchClearPIIFunction;
  /** Whether LANGEVALS_ENDPOINT is configured (truthy check) */
  isLangevalsConfigured: boolean;
  /** Whether running in production (NODE_ENV === "production") */
  isProduction: boolean;
  /** Maximum attribute value length for PII redaction; values exceeding this are skipped */
  piiRedactionMaxAttributeLength: number;
}

/**
 * Default batch PII clearing: uses Presidio batch API, falls back to individual Google DLP calls.
 */
const defaultBatchClearPII: BatchClearPIIFunction = async (texts, options) => {
  const { piiRedactionLevel, mainMethod } = options;

  if (mainMethod === "google_dlp") {
    // Google DLP doesn't support batch natively, fall back to individual calls
    return Promise.all(
      texts.map(async (text) => {
        const wrapper: Record<string, string> = { value: text };
        await googleDLPClearPII(wrapper, "value", piiRedactionLevel);
        return wrapper.value !== text ? wrapper.value : null;
      }),
    );
  }

  return defaultBatchPresidioClearPII(texts, piiRedactionLevel);
};

/**
 * Static defaults for PII service deps (no lazy caching, no mutable state).
 */
const PII_DEFAULTS: OtlpSpanPiiRedactionServiceDependencies = {
  batchClearPII: defaultBatchClearPII,
  isLangevalsConfigured: !!env.LANGEVALS_ENDPOINT,
  isProduction: env.NODE_ENV === "production",
  piiRedactionMaxAttributeLength: DEFAULT_PII_REDACTION_MAX_ATTRIBUTE_LENGTH,
};

/**
 * A collected string value with a back-reference for applying the redacted result.
 */
type StringEntry = {
  /** The object containing the string value */
  owner: OtlpAnyValue | { message?: string | null };
  /** The property name on owner that holds the string value */
  field: "stringValue" | "message";
  /** The original text value */
  text: string;
};

/**
 * Service responsible for redacting PII from OTLP span data.
 * Scans all string attribute values and sends them in a single batch
 * to the PII detection service. This service should be applied BEFORE
 * creating immutable events in the event sourcing pipeline.
 */
export class OtlpSpanPiiRedactionService {
  private readonly deps: OtlpSpanPiiRedactionServiceDependencies;
  private readonly logger = createLogger(
    "langwatch:trace-processing:span-pii-redaction-service",
  );

  constructor(deps: Partial<OtlpSpanPiiRedactionServiceDependencies> = {}) {
    const merged = { ...PII_DEFAULTS, ...deps };
    const maxLen = merged.piiRedactionMaxAttributeLength;
    merged.piiRedactionMaxAttributeLength =
      Number.isFinite(maxLen) && maxLen >= 0
        ? Math.floor(maxLen)
        : DEFAULT_PII_REDACTION_MAX_ATTRIBUTE_LENGTH;
    this.deps = merged;
  }

  /**
   * Redacts PII from all string attributes in the span and resource.
   * Mutates the span and resource in place for efficiency.
   *
   * Collects all string values from span attributes, events, links,
   * status.message, and resource attributes, then sends them in a
   * single batch to the PII detection service.
   *
   * @param span - The OTLP span to redact
   * @param resource - The OTLP resource to redact (nullable)
   * @param piiRedactionLevel - The project's PII redaction level
   */
  async redactSpan(
    span: OtlpSpan,
    resource: OtlpResource | null,
    piiRedactionLevel: PIIRedactionLevel,
  ): Promise<void> {
    if (process.env.DISABLE_PII_REDACTION) {
      return;
    }

    if (piiRedactionLevel === "DISABLED") {
      return;
    }

    const piiEnforced = this.deps.isProduction;

    if (!this.deps.isLangevalsConfigured) {
      if (piiEnforced) {
        throw new Error(
          "LANGEVALS_ENDPOINT is not set, PII check cannot be performed",
        );
      }
      return;
    }

    const options: PIICheckOptions = {
      piiRedactionLevel,
      enforced: piiEnforced,
      mainMethod: "presidio",
    };

    const entries: StringEntry[] = [];
    let anySkipped = false;
    let anyRedacted = false;

    // Collect all string values from span attributes, events, and links
    for (const attrs of this.collectAllAttributeSets(span)) {
      const result = this.collectStringEntries(attrs, entries);
      anySkipped ||= result.skipped;
      anyRedacted ||= result.collected;
    }

    // Collect status.message
    if (
      span.status?.message != null &&
      typeof span.status.message === "string" &&
      span.status.message.length > 0
    ) {
      if (
        span.status.message.length > this.deps.piiRedactionMaxAttributeLength
      ) {
        anySkipped = true;
      } else {
        entries.push({
          owner: span.status,
          field: "message",
          text: span.status.message,
        });
        anyRedacted = true;
      }
    }

    // Collect resource attributes
    if (resource?.attributes) {
      const result = this.collectStringEntries(resource.attributes, entries);
      anySkipped ||= result.skipped;
      anyRedacted ||= result.collected;
    }

    // Mark span with pii_redaction_status when any attributes were skipped
    if (anySkipped) {
      const statusValue = anyRedacted ? "partial" : "none";
      const existingIdx = span.attributes.findIndex(
        (a) => a.key === ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS,
      );
      if (existingIdx !== -1) {
        span.attributes[existingIdx]!.value = { stringValue: statusValue };
      } else {
        span.attributes.push({
          key: ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS,
          value: { stringValue: statusValue },
        });
      }
    }

    if (entries.length === 0) {
      return;
    }

    // Batch all string values into a single PII detection call
    const results = await this.deps.batchClearPII(
      entries.map((e) => e.text),
      options,
    );

    // Apply redacted values back to their original locations
    for (let i = 0; i < entries.length; i++) {
      const redacted = results[i];
      if (redacted != null) {
        const entry = entries[i]!;
        (entry.owner as Record<string, unknown>)[entry.field] = redacted;
      }
    }
  }

  /**
   * Redacts PII from the body and attributes of a log record.
   * Mutates the log record in place for efficiency.
   *
   * @param log - The log record to redact (body and attributes)
   * @param piiRedactionLevel - The project's PII redaction level
   */
  async redactLog(
    log: {
      body: string;
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
    },
    piiRedactionLevel: PIIRedactionLevel,
  ): Promise<void> {
    if (process.env.DISABLE_PII_REDACTION) {
      return;
    }

    if (piiRedactionLevel === "DISABLED") {
      return;
    }

    const piiEnforced = this.deps.isProduction;

    if (!this.deps.isLangevalsConfigured) {
      if (piiEnforced) {
        throw new Error(
          "LANGEVALS_ENDPOINT is not set, PII check cannot be performed",
        );
      }
      return;
    }

    const options: PIICheckOptions = {
      piiRedactionLevel,
      enforced: piiEnforced,
      mainMethod: "presidio",
    };

    const texts: string[] = [];
    const refs: { obj: Record<string, string>; key: string }[] = [];

    // Body
    if (log.body) {
      texts.push(log.body);
      refs.push({ obj: log as unknown as Record<string, string>, key: "body" });
    }

    // Attributes
    for (const key of Object.keys(log.attributes)) {
      if (log.attributes[key]) {
        texts.push(log.attributes[key]!);
        refs.push({ obj: log.attributes, key });
      }
    }

    // Resource attributes
    for (const key of Object.keys(log.resourceAttributes)) {
      if (log.resourceAttributes[key]) {
        texts.push(log.resourceAttributes[key]!);
        refs.push({ obj: log.resourceAttributes, key });
      }
    }

    if (texts.length === 0) return;

    const results = await this.deps.batchClearPII(texts, options);
    for (let i = 0; i < refs.length; i++) {
      const redacted = results[i];
      if (redacted != null) {
        refs[i]!.obj[refs[i]!.key] = redacted;
      }
    }
  }

  /**
   * Redacts PII from metric attributes and resource attributes.
   * Metric values are numeric and don't need redaction, but attributes
   * can contain arbitrary user-supplied strings.
   * Mutates the record in place for efficiency.
   */
  async redactMetricAttributes(
    metric: {
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
    },
    piiRedactionLevel: PIIRedactionLevel,
  ): Promise<void> {
    if (process.env.DISABLE_PII_REDACTION) {
      return;
    }

    if (piiRedactionLevel === "DISABLED") {
      return;
    }

    const piiEnforced = this.deps.isProduction;

    if (!this.deps.isLangevalsConfigured) {
      if (piiEnforced) {
        throw new Error(
          "LANGEVALS_ENDPOINT is not set, PII check cannot be performed",
        );
      }
      return;
    }

    const options: PIICheckOptions = {
      piiRedactionLevel,
      enforced: piiEnforced,
      mainMethod: "presidio",
    };

    const texts: string[] = [];
    const refs: { obj: Record<string, string>; key: string }[] = [];

    for (const key of Object.keys(metric.attributes)) {
      if (metric.attributes[key]) {
        texts.push(metric.attributes[key]!);
        refs.push({ obj: metric.attributes, key });
      }
    }

    for (const key of Object.keys(metric.resourceAttributes)) {
      if (metric.resourceAttributes[key]) {
        texts.push(metric.resourceAttributes[key]!);
        refs.push({ obj: metric.resourceAttributes, key });
      }
    }

    if (texts.length === 0) return;

    const results = await this.deps.batchClearPII(texts, options);
    for (let i = 0; i < refs.length; i++) {
      const redacted = results[i];
      if (redacted != null) {
        refs[i]!.obj[refs[i]!.key] = redacted;
      }
    }
  }

  private collectAllAttributeSets(span: OtlpSpan): OtlpKeyValue[][] {
    return [
      span.attributes,
      ...span.events.map((e) => e.attributes),
      ...span.links.map((l) => l.attributes),
    ];
  }

  /**
   * Collects string attribute values into the entries array.
   * Returns whether any attributes were skipped (oversized) or collected.
   */
  private collectStringEntries(
    attributes: OtlpKeyValue[],
    entries: StringEntry[],
  ): { skipped: boolean; collected: boolean } {
    let skipped = false;
    let collected = false;

    for (const attr of attributes) {
      if (
        attr.value.stringValue !== undefined &&
        attr.value.stringValue !== null
      ) {
        if (
          attr.value.stringValue.length >
          this.deps.piiRedactionMaxAttributeLength
        ) {
          this.logger.warn(
            {
              attributeKey: attr.key,
              valueLength: attr.value.stringValue.length,
              maxLength: this.deps.piiRedactionMaxAttributeLength,
            },
            "Skipping PII redaction for oversized attribute value",
          );
          skipped = true;
          continue;
        }
        entries.push({
          owner: attr.value,
          field: "stringValue",
          text: attr.value.stringValue,
        });
        collected = true;
      }
    }
    return { skipped, collected };
  }
}
