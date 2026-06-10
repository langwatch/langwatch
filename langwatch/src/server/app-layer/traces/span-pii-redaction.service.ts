import { env } from "~/env.mjs";
import {
  batchPresidioClearPII as defaultBatchPresidioClearPII,
  googleDLPClearPII,
  type PIICheckOptions,
} from "~/server/background/workers/collector/piiCheck";
import { featureFlagService } from "~/server/featureFlag";
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
import type {
  PiiLevel,
  ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";
import { getDataPrivacyPolicyService } from "~/server/data-privacy/dataPrivacyPolicy.service";
import {
  compilePolicySecretPatterns,
  redactAttributeNative,
  redactStringNative,
} from "~/server/data-privacy/redaction/applyContentRedaction";

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
 * The slice of the data-privacy service the redactor needs: resolving a
 * project's effective policy to drive the native secrets + essential-PII pass.
 */
export type DataPrivacyResolver = {
  getResolvedForProject(args: {
    projectId: string;
  }): Promise<ResolvedDataPrivacy>;
};

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
  /**
   * Resolves the scoped data-privacy policy for the native passes. Optional and
   * lazily defaulted to the process-wide service, so callers that never pass a
   * tenant (and most tests) don't need to provide it.
   */
  dataPrivacyResolver?: DataPrivacyResolver;
}

/**
 * Default batch PII clearing: uses Presidio batch API, falls back to individual Google DLP calls.
 */
const runGoogleDlpBatch = (
  texts: string[],
  piiRedactionLevel: PIIRedactionLevel,
): Promise<(string | null)[]> =>
  Promise.all(
    texts.map(async (text) => {
      const wrapper = { value: text };
      await googleDLPClearPII(wrapper, "value", piiRedactionLevel);
      return wrapper.value !== text ? wrapper.value : null;
    }),
  );

const defaultBatchClearPII: BatchClearPIIFunction = async (texts, options) => {
  const { piiRedactionLevel, mainMethod } = options;

  if (mainMethod === "google_dlp") {
    return runGoogleDlpBatch(texts, piiRedactionLevel);
  }

  try {
    return await defaultBatchPresidioClearPII(texts, piiRedactionLevel);
  } catch {
    return await runGoogleDlpBatch(texts, piiRedactionLevel);
  }
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

function legacyToPiiLevel(level: PIIRedactionLevel): PiiLevel {
  switch (level) {
    case "STRICT":
      return "strict";
    case "DISABLED":
      return "disabled";
    default:
      return "essential";
  }
}

/**
 * The PII level to enforce, reconciling the resolved policy with the project's
 * legacy piiRedactionLevel during the migration window. A resolved level other
 * than the platform default ("essential") can only come from an explicit rule,
 * so it wins; at the default we honor the legacy field so pre-migration STRICT/
 * DISABLED projects keep their level until the backfill writes an explicit rule.
 */
function reconcilePiiLevel(
  policyLevel: PiiLevel,
  legacyLevel: PIIRedactionLevel,
): PiiLevel {
  if (policyLevel !== "essential") return policyLevel;
  return legacyToPiiLevel(legacyLevel);
}

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
 * Accumulator used by the record-shaped redaction paths (logs, metrics).
 * Tracks parallel arrays of texts and back-references plus a cumulative
 * length budget enforced by `tryPush`.
 */
type RedactionBatch = {
  texts: string[];
  refs: { obj: Record<string, string>; key: string }[];
  tryPush: (obj: Record<string, string>, key: string, value: string) => void;
};

/**
 * Service responsible for redacting PII from OTLP span data.
 *
 * Two paths exist. With a scoped data-privacy policy resolvable for the tenant
 * (the normal ingestion path), the secrets scrubber and the native essential-PII
 * recognizers run in-process with no external call; only the strict level still
 * escalates to the analysis-service batch. Without a tenant, or with the
 * LANGWATCH_DATA_PRIVACY_ENFORCEMENT kill switch set, the legacy batch path runs
 * unchanged. This service is applied BEFORE creating immutable events in the
 * event sourcing pipeline.
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
   * Resolve the native-redaction context for a tenant: the effective policy
   * (PII level reconciled with the legacy field) and that level. Returns null
   * when native enforcement is skipped — the kill switch is set, no tenant is
   * known (older callers), or resolution failed — so the caller runs the legacy
   * batch path and PII is never silently left in.
   */
  private async resolveNativeContext(
    tenantId: string | undefined,
    legacyLevel: PIIRedactionLevel,
  ): Promise<{ policy: ResolvedDataPrivacy; level: PiiLevel } | null> {
    if (process.env.LANGWATCH_DATA_PRIVACY_ENFORCEMENT === "off") return null;
    if (!tenantId) return null;
    let resolved: ResolvedDataPrivacy;
    try {
      const service =
        this.deps.dataPrivacyResolver ?? getDataPrivacyPolicyService();
      resolved = await service.getResolvedForProject({ projectId: tenantId });
    } catch (error) {
      this.logger.warn(
        { error, tenantId },
        "Data-privacy resolution failed; falling back to the legacy PII path",
      );
      return null;
    }
    const level = reconcilePiiLevel(resolved.pii.level, legacyLevel);
    return { policy: { ...resolved, pii: { level } }, level };
  }

  /** Whether the native pass would change anything for this policy. */
  private nativePassActive(policy: ResolvedDataPrivacy): boolean {
    return policy.secrets.enabled || policy.pii.level === "essential";
  }

  private nativeSecretPatterns(
    policy: ResolvedDataPrivacy,
  ): readonly RegExp[] | undefined {
    return policy.secrets.enabled
      ? compilePolicySecretPatterns(policy)
      : undefined;
  }

  private redactKeyValuesNative(
    attributes: OtlpKeyValue[],
    policy: ResolvedDataPrivacy,
    compiledSecretPatterns: readonly RegExp[] | undefined,
  ): void {
    for (const attr of attributes) {
      const value = attr.value.stringValue;
      if (typeof value === "string" && value.length > 0) {
        const { text } = redactAttributeNative({
          key: attr.key,
          value,
          policy,
          compiledSecretPatterns,
        });
        if (text !== value) attr.value.stringValue = text;
      }
    }
  }

  private redactRecordNative(
    record: Record<string, string>,
    policy: ResolvedDataPrivacy,
    compiledSecretPatterns: readonly RegExp[] | undefined,
  ): void {
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (value && value.length > 0) {
        const { text } = redactAttributeNative({
          key,
          value,
          policy,
          compiledSecretPatterns,
        });
        if (text !== value) record[key] = text;
      }
    }
  }

  /**
   * Native in-process pass over every string attribute, event/link attribute,
   * status message, and resource attribute of a span. Runs the secrets scrubber
   * (when enabled) and essential-PII recognizers (when the effective level is
   * essential). Mutates in place; no external call.
   */
  private applyNativeSpanPass(
    span: OtlpSpan,
    resource: OtlpResource | null,
    policy: ResolvedDataPrivacy,
  ): void {
    if (!this.nativePassActive(policy)) return;
    const compiled = this.nativeSecretPatterns(policy);
    for (const attrs of this.collectAllAttributeSets(span)) {
      this.redactKeyValuesNative(attrs, policy, compiled);
    }
    if (
      span.status?.message != null &&
      typeof span.status.message === "string" &&
      span.status.message.length > 0
    ) {
      const { text } = redactStringNative({
        text: span.status.message,
        policy,
        compiledSecretPatterns: compiled,
      });
      if (text !== span.status.message) span.status.message = text;
    }
    if (resource?.attributes) {
      this.redactKeyValuesNative(resource.attributes, policy, compiled);
    }
  }

  /** Native pass over a log record's body + attribute records. */
  private applyNativeLogPass(
    log: {
      body: string;
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
    },
    policy: ResolvedDataPrivacy,
  ): void {
    if (!this.nativePassActive(policy)) return;
    const compiled = this.nativeSecretPatterns(policy);
    if (log.body) {
      const { text } = redactStringNative({
        text: log.body,
        policy,
        compiledSecretPatterns: compiled,
      });
      if (text !== log.body) log.body = text;
    }
    this.redactRecordNative(log.attributes, policy, compiled);
    this.redactRecordNative(log.resourceAttributes, policy, compiled);
  }

  /**
   * Redacts the span + resource in place. Native secrets + essential PII run
   * in-process when a policy is resolvable for the tenant; only the strict level
   * escalates to the analysis-service batch. Without a tenant (or with the kill
   * switch set) the legacy batch path runs unchanged.
   */
  async redactSpan(
    span: OtlpSpan,
    resource: OtlpResource | null,
    piiRedactionLevel: PIIRedactionLevel,
    tenantId?: string,
  ): Promise<void> {
    const native = await this.resolveNativeContext(tenantId, piiRedactionLevel);
    if (!native) {
      await this.lambdaRedactSpan(span, resource, piiRedactionLevel);
      return;
    }
    this.applyNativeSpanPass(span, resource, native.policy);
    if (native.level === "strict") {
      await this.lambdaRedactSpan(span, resource, "STRICT");
    }
  }

  /**
   * The analysis-service batch path for spans: collects all string values from
   * span attributes, events, links, status.message, and resource attributes,
   * then sends them in a single batch to the PII detection service. Used for the
   * strict level and the legacy (no-policy) fallback. Mutates in place.
   */
  private async lambdaRedactSpan(
    span: OtlpSpan,
    resource: OtlpResource | null,
    piiRedactionLevel: PIIRedactionLevel,
  ): Promise<void> {
    const options = await this.buildOptions(piiRedactionLevel);
    if (!options) return;

    const entries: StringEntry[] = [];
    let anySkipped = false;
    let anyRedacted = false;
    let totalLength = 0;

    for (const attrs of this.collectAllAttributeSets(span)) {
      const result = this.collectStringEntries(attrs, entries, totalLength);
      anySkipped ||= result.skipped;
      anyRedacted ||= result.collected;
      totalLength = result.totalLength;
    }

    if (
      span.status?.message != null &&
      typeof span.status.message === "string" &&
      span.status.message.length > 0
    ) {
      if (
        totalLength + span.status.message.length >
        this.deps.piiRedactionMaxAttributeLength
      ) {
        anySkipped = true;
      } else {
        entries.push({
          owner: span.status,
          field: "message",
          text: span.status.message,
        });
        totalLength += span.status.message.length;
        anyRedacted = true;
      }
    }

    if (resource?.attributes) {
      const result = this.collectStringEntries(
        resource.attributes,
        entries,
        totalLength,
      );
      anySkipped ||= result.skipped;
      anyRedacted ||= result.collected;
    }

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

    const results = await this.deps.batchClearPII(
      entries.map((e) => e.text),
      options,
    );

    if (results.length !== entries.length) {
      throw new Error(
        `Incomplete PII batch: got ${results.length} results for ${entries.length} inputs`,
      );
    }

    for (let i = 0; i < entries.length; i++) {
      const redacted = results[i];
      if (redacted != null) {
        const entry = entries[i]!;
        (entry.owner as Record<string, unknown>)[entry.field] = redacted;
      }
    }
  }

  /**
   * Redacts the body + attributes of a log record in place. Native secrets +
   * essential PII run in-process when a policy is resolvable; strict still uses
   * the analysis-service batch; the no-policy path keeps the legacy behavior.
   */
  async redactLog(
    log: {
      body: string;
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
    },
    piiRedactionLevel: PIIRedactionLevel,
    tenantId?: string,
  ): Promise<void> {
    const native = await this.resolveNativeContext(tenantId, piiRedactionLevel);
    if (!native) {
      await this.lambdaRedactLog(log, piiRedactionLevel);
      return;
    }
    this.applyNativeLogPass(log, native.policy);
    if (native.level === "strict") {
      await this.lambdaRedactLog(log, "STRICT");
    }
  }

  private async lambdaRedactLog(
    log: {
      body: string;
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
    },
    piiRedactionLevel: PIIRedactionLevel,
  ): Promise<void> {
    const options = await this.buildOptions(piiRedactionLevel);
    if (!options) return;

    const batch = this.createRedactionBatch();
    if (log.body) {
      batch.tryPush(log as unknown as Record<string, string>, "body", log.body);
    }
    this.collectRecordEntries(batch, log.attributes);
    this.collectRecordEntries(batch, log.resourceAttributes);

    await this.applyRedactionBatch(batch, options);
  }

  /**
   * Redacts metric + resource attributes in place. Metric values are numeric;
   * only the string attributes carry user content. Native secrets + essential
   * PII run in-process when a policy is resolvable; strict uses the batch.
   */
  async redactMetricAttributes(
    metric: {
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
    },
    piiRedactionLevel: PIIRedactionLevel,
    tenantId?: string,
  ): Promise<void> {
    const native = await this.resolveNativeContext(tenantId, piiRedactionLevel);
    if (!native) {
      await this.lambdaRedactMetricAttributes(metric, piiRedactionLevel);
      return;
    }
    if (this.nativePassActive(native.policy)) {
      const compiled = this.nativeSecretPatterns(native.policy);
      this.redactRecordNative(metric.attributes, native.policy, compiled);
      this.redactRecordNative(
        metric.resourceAttributes,
        native.policy,
        compiled,
      );
    }
    if (native.level === "strict") {
      await this.lambdaRedactMetricAttributes(metric, "STRICT");
    }
  }

  private async lambdaRedactMetricAttributes(
    metric: {
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
    },
    piiRedactionLevel: PIIRedactionLevel,
  ): Promise<void> {
    const options = await this.buildOptions(piiRedactionLevel);
    if (!options) return;

    const batch = this.createRedactionBatch();
    this.collectRecordEntries(batch, metric.attributes);
    this.collectRecordEntries(batch, metric.resourceAttributes);

    await this.applyRedactionBatch(batch, options);
  }

  /**
   * Returns PIICheckOptions for the redaction call, or null when redaction
   * should be skipped (disabled, no langevals in dev, etc). Throws when
   * langevals is required but unset in production.
   */
  private async buildOptions(
    piiRedactionLevel: PIIRedactionLevel,
  ): Promise<PIICheckOptions | null> {
    const disabled = await featureFlagService.isEnabled(
      "ops_pii_redaction_disabled",
      { distinctId: "span-pii-service", defaultValue: false },
    );
    if (disabled) return null;
    if (piiRedactionLevel === "DISABLED") return null;

    const piiEnforced = this.deps.isProduction;

    if (!this.deps.isLangevalsConfigured) {
      if (piiEnforced) {
        throw new Error(
          "LANGEVALS_ENDPOINT is not set, PII check cannot be performed",
        );
      }
      return null;
    }

    return {
      piiRedactionLevel,
      enforced: piiEnforced,
      mainMethod: "presidio",
    };
  }

  private createRedactionBatch(): RedactionBatch {
    const texts: string[] = [];
    const refs: { obj: Record<string, string>; key: string }[] = [];
    const maxLen = this.deps.piiRedactionMaxAttributeLength;
    const logger = this.logger;
    const state = { totalLength: 0 };

    return {
      texts,
      refs,
      tryPush(obj, key, value) {
        if (state.totalLength + value.length > maxLen) {
          logger.warn(
            {
              key,
              valueLength: value.length,
              totalLength: state.totalLength,
              maxLength: maxLen,
            },
            "Skipping PII redaction — cumulative batch size would exceed limit",
          );
          return;
        }
        texts.push(value);
        refs.push({ obj, key });
        state.totalLength += value.length;
      },
    };
  }

  private collectRecordEntries(
    batch: RedactionBatch,
    record: Record<string, string>,
  ): void {
    for (const key of Object.keys(record)) {
      if (record[key]) {
        batch.tryPush(record, key, record[key]!);
      }
    }
  }

  private async applyRedactionBatch(
    batch: RedactionBatch,
    options: PIICheckOptions,
  ): Promise<void> {
    if (batch.texts.length === 0) return;

    const results = await this.deps.batchClearPII(batch.texts, options);

    if (results.length !== batch.refs.length) {
      throw new Error(
        `Incomplete PII batch: got ${results.length} results for ${batch.refs.length} inputs`,
      );
    }

    for (let i = 0; i < batch.refs.length; i++) {
      const redacted = results[i];
      if (redacted != null) {
        batch.refs[i]!.obj[batch.refs[i]!.key] = redacted;
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
   * Enforces a cumulative character budget — once adding a value would
   * exceed piiRedactionMaxAttributeLength the value is skipped.
   */
  private collectStringEntries(
    attributes: OtlpKeyValue[],
    entries: StringEntry[],
    currentTotalLength: number,
  ): { skipped: boolean; collected: boolean; totalLength: number } {
    let skipped = false;
    let collected = false;
    let totalLength = currentTotalLength;

    for (const attr of attributes) {
      if (
        attr.value.stringValue !== undefined &&
        attr.value.stringValue !== null &&
        attr.value.stringValue.length > 0
      ) {
        if (
          totalLength + attr.value.stringValue.length >
          this.deps.piiRedactionMaxAttributeLength
        ) {
          this.logger.warn(
            {
              attributeKey: attr.key,
              valueLength: attr.value.stringValue.length,
              totalLength,
              maxLength: this.deps.piiRedactionMaxAttributeLength,
            },
            "Skipping PII redaction — cumulative batch size would exceed limit",
          );
          skipped = true;
          continue;
        }
        entries.push({
          owner: attr.value,
          field: "stringValue",
          text: attr.value.stringValue,
        });
        totalLength += attr.value.stringValue.length;
        collected = true;
      }
    }
    return { skipped, collected, totalLength };
  }
}
