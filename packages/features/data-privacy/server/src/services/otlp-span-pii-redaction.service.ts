/**
 * PII redaction over an OTLP span, harvested for a process composed from
 * packages.
 *
 * BYTE-FAITHFUL, SPAN HALF ONLY. Every member below is the application's
 * `platform/app/src/server/app-layer/traces/span-pii-redaction.service.ts`
 * member of the same name, body for body. The record-shaped half — `redactLog`,
 * `lambdaRedactLog`, `applyNativeLogPass`, `redactMetricAttributes`,
 * `lambdaRedactMetricAttributes`, `redactRecordNative`,
 * `createRedactionBatch`, `collectRecordEntries`, `applyRedactionBatch` and
 * the `RedactionBatch` type — came across when the application's copy was
 * deleted, because it is what answers `LogRedactionPort` and
 * `MetricRedactionPort` for the log and metric conversions and there was
 * nowhere else left for it to live.
 *
 * THE APPLICATION'S COPY STAYS AS IT IS while both graphs ingest. Everything
 * the two agree about is a data-protection contract between two processes
 * writing into the same store, and drift in it is silent in the worst
 * direction: a span redacted by one process and not the other leaves personal
 * data in ClickHouse with nothing in the row to say a pass was skipped.
 */

import type { ResolvedDataPrivacy } from "@langwatch/data-privacy-contract";
import { PRIVACY_PII_INCOMPLETE_MARKER_ATTR } from "@langwatch/data-privacy-contract";
import type { TenantId } from "@langwatch/eventing";
import { redactAttributeNative, redactStringNative } from "@langwatch/redaction/pii";
import {
  DEFAULT_PII_REDACTION_MAX_ATTRIBUTE_LENGTH,
  type OtlpSpanPiiRedactionServiceDependencies,
  PiiRedactionPolicyService,
} from "./pii-redaction-policy.service";

import { createLogger } from "@langwatch/observability";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";
import type { PIICheckOptions } from "../ports/pii-analysis.port";
import type { OtlpAnyValue, OtlpKeyValue, OtlpResource, OtlpSpan } from "@langwatch/trace-contract";
import { ATTR_KEYS } from "@langwatch/trace-contract";

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
 *
 * Two paths exist. With a scoped data-privacy policy resolvable for the tenant
 * (the normal ingestion path), the secrets scrubber and the native essential-PII
 * recognizers run in-process with no external call. The strict level runs that
 * same native floor first, then escalates to the analysis-service batch for the
 * names/locations the regex recognizers can't catch — so an unreachable (or, in
 * dev, unconfigured) analysis service downgrades strict to essential instead of
 * leaking. Without a tenant, or with the LANGWATCH_DATA_PRIVACY_ENFORCEMENT kill
 * switch set, the analysis-service batch path runs unchanged. This service is
 * applied BEFORE creating immutable events in the event sourcing pipeline.
 */
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

export class OtlpSpanPiiRedactionService {
  static create(deps: OtlpSpanPiiRedactionServiceDependencies): OtlpSpanPiiRedactionService {
    return new OtlpSpanPiiRedactionService(deps);
  }

  private readonly deps: OtlpSpanPiiRedactionServiceDependencies;
  private readonly policy: PiiRedactionPolicyService;
  private readonly logger = createLogger("langwatch:trace-processing:span-pii-redaction-service");

  private constructor(deps: OtlpSpanPiiRedactionServiceDependencies) {
    const merged = { ...deps };
    const maxLen = merged.piiRedactionMaxAttributeLength;
    merged.piiRedactionMaxAttributeLength =
      Number.isFinite(maxLen) && maxLen >= 0
        ? Math.floor(maxLen)
        : DEFAULT_PII_REDACTION_MAX_ATTRIBUTE_LENGTH;
    this.deps = merged;
    this.policy = PiiRedactionPolicyService.create(merged);
  }

  private redactKeyValuesNative(
    attributes: OtlpKeyValue[],
    policy: ResolvedDataPrivacy,
    compiled: {
      secrets: readonly RegExp[] | undefined;
      piiExceptions: readonly RegExp[] | undefined;
    },
  ): void {
    for (const attr of attributes) {
      const value = attr.value.stringValue;
      if (typeof value === "string" && value.length > 0) {
        const { text } = redactAttributeNative({
          key: attr.key,
          value,
          policy,
          compiledSecretPatterns: compiled.secrets,
          compiledPiiExceptions: compiled.piiExceptions,
        });
        if (text !== value) {
          attr.value.stringValue = text;
        }
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
    if (!this.policy.nativePassActive(policy)) {
      return;
    }

    const compiled = this.policy.compileNativePatterns(policy);
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
        compiledSecretPatterns: compiled.secrets,
        compiledPiiExceptions: compiled.piiExceptions,
      });
      if (text !== span.status.message) {
        span.status.message = text;
      }
    }

    if (resource?.attributes) {
      this.redactKeyValuesNative(resource.attributes, policy, compiled);
    }
  }

  /**
   * Redacts the span + resource in place. Native secrets + essential PII run
   * in-process when a policy is resolvable for the tenant; the strict level and
   * any custom level that selected analysis-service identifiers escalate to the
   * batch for those. Without a tenant (or with the kill switch set) the
   * analysis-service batch path runs unchanged.
   */
  async redactSpan(
    span: OtlpSpan,
    resource: OtlpResource | null,
    piiRedactionLevel: PIIRedactionLevel,
    tenantId?: TenantId,
  ): Promise<void> {
    const native = await this.policy.tryResolveNativeContext(tenantId, piiRedactionLevel);
    if (!native) {
      await this.lambdaRedactSpan(span, resource, piiRedactionLevel);

      return;
    }

    this.applyNativeSpanPass(span, resource, native.policy);
    const lambda = this.policy.tryLambdaAfterNative(native.policy);
    if (lambda) {
      try {
        const ran = await this.lambdaRedactSpan(span, resource, "STRICT", {
          entities: lambda.entities,
          exceptPatterns: lambda.exceptPatterns,
        });
        // Mark the span only when strict could not run because the analysis
        // service is genuinely unavailable (not configured in dev): the native
        // floor redacted the pattern-based identifiers but names/locations slip
        // through, so the read path warns instead of implying it is fully
        // scrubbed. When PII redaction is intentionally turned off by the kill
        // switch the lambda is skipped on purpose (with langevals configured),
        // so no warning is shown.
        if (!ran && !this.deps.isLangevalsConfigured) {
          this.markPiiAnalysisIncomplete(span);
        }
      } catch (error) {
        // In production the analysis service is enforced: re-throw so the
        // pipeline aborts the span rather than storing names/locations. In
        // development (or self-hosted without the service) the native floor
        // stands and the span is marked, so the gap is visible, not silent.
        if (this.deps.isProduction) {
          throw error;
        }

        this.logger.warn(
          { error },
          "strict PII analysis service unavailable; native floor stands, marking span as incomplete",
        );
        this.markPiiAnalysisIncomplete(span);
      }
    }
  }

  /**
   * Stamp the marker that records an incomplete strict redaction (idempotent),
   * so the read path can surface it. Names/locations may remain in the content.
   */
  private markPiiAnalysisIncomplete(span: OtlpSpan): void {
    if (span.attributes.some((a) => a.key === PRIVACY_PII_INCOMPLETE_MARKER_ATTR)) {
      return;
    }

    span.attributes.push({
      key: PRIVACY_PII_INCOMPLETE_MARKER_ATTR,
      value: { stringValue: "strict" },
    });
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
    lambda?: {
      entities?: readonly string[];
      exceptPatterns?: readonly string[];
    },
  ): Promise<boolean> {
    const options = await this.policy.tryBuildOptions(
      piiRedactionLevel,
      lambda?.entities,
      lambda?.exceptPatterns,
    );
    // No options means the analysis pass was skipped (disabled, or the service
    // is not configured outside production) — report that it did not run so the
    // caller can mark a requested strict pass as incomplete.
    if (!options) {
      return false;
    }

    const { entries, anySkipped, anyRedacted } = this.collectSpanEntries(span, resource);

    if (anySkipped) {
      this.markRedactionStatus(span, anyRedacted ? "partial" : "none");
    }

    if (entries.length === 0) {
      return true;
    }

    const results = await this.policy.clearBatch(
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

    return true;
  }

  /**
   * Every string this span offers the analysis service, with the budget
   * enforced across all of them: attribute sets first, then the status
   * message, then the resource. Lifted out of `lambdaRedactSpan` so the
   * collection and the batch call are each readable on their own; the order,
   * the budget arithmetic and the two flags are the application's.
   */
  private collectSpanEntries(
    span: OtlpSpan,
    resource: OtlpResource | null,
  ): { entries: StringEntry[]; anySkipped: boolean; anyRedacted: boolean } {
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
      if (totalLength + span.status.message.length > this.deps.piiRedactionMaxAttributeLength) {
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
      const result = this.collectStringEntries(resource.attributes, entries, totalLength);
      anySkipped ||= result.skipped;
      anyRedacted ||= result.collected;
    }

    return { entries, anySkipped, anyRedacted };
  }

  /**
   * Record that the batch covered some of the span, or none of it. Written
   * once per span: a second pass overwrites the value rather than appending a
   * second attribute, or a reader would see two contradictory answers.
   */
  private markRedactionStatus(span: OtlpSpan, statusValue: "partial" | "none"): void {
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

  /**
   * `record` may be keyed by an addressing path rather than by the attribute
   * name (the log and metric pipelines flatten a decoded OTLP tree into one).
   * `attributeNames` restores the real name for the sensitive-NAME rules, which
   * a path can never satisfy; without it those rules silently never fire.
   */
  private redactRecordNative({
    record,
    policy,
    compiled,
    attributeNames,
  }: {
    record: Record<string, string>;
    policy: ResolvedDataPrivacy;
    compiled: {
      secrets: readonly RegExp[] | undefined;
      piiExceptions: readonly RegExp[] | undefined;
    };
    attributeNames?: Record<string, string>;
  }): void {
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (value && value.length > 0) {
        const { text } = redactAttributeNative({
          key: attributeNames?.[key] ?? key,
          value,
          policy,
          compiledSecretPatterns: compiled.secrets,
          compiledPiiExceptions: compiled.piiExceptions,
        });
        if (text !== value) record[key] = text;
      }
    }
  }

  /** Native pass over a log record's body + attribute records. */
  private applyNativeLogPass(
    log: {
      body: string;
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
      attributeNames?: Record<string, string>;
    },
    policy: ResolvedDataPrivacy,
  ): void {
    if (!this.policy.nativePassActive(policy)) return;
    const compiled = this.policy.compileNativePatterns(policy);
    if (log.body) {
      const { text } = redactStringNative({
        text: log.body,
        policy,
        compiledSecretPatterns: compiled.secrets,
        compiledPiiExceptions: compiled.piiExceptions,
      });
      if (text !== log.body) log.body = text;
    }
    this.redactRecordNative({
      record: log.attributes,
      policy,
      compiled,
      attributeNames: log.attributeNames,
    });
    this.redactRecordNative({
      record: log.resourceAttributes,
      policy,
      compiled,
    });
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
      /**
       * The real OTLP attribute name behind each key of `attributes`, where the
       * two differ. Declared here because the native pass reads it: without it
       * the public signature promises less than the method actually honours,
       * and a caller building the argument inline could not pass it at all.
       */
      attributeNames?: Record<string, string>;
    },
    piiRedactionLevel: PIIRedactionLevel,
    tenantId?: TenantId,
  ): Promise<void> {
    const native = await this.policy.tryResolveNativeContext(tenantId, piiRedactionLevel);
    if (!native) {
      await this.lambdaRedactLog(log, piiRedactionLevel);
      return;
    }
    this.applyNativeLogPass(log, native.policy);
    const lambda = this.policy.tryLambdaAfterNative(native.policy);
    if (lambda) {
      await this.lambdaRedactLog(log, "STRICT", {
        entities: lambda.entities,
        exceptPatterns: lambda.exceptPatterns,
      });
    }
  }

  private async lambdaRedactLog(
    log: {
      body: string;
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
    },
    piiRedactionLevel: PIIRedactionLevel,
    lambda?: {
      entities?: readonly string[];
      exceptPatterns?: readonly string[];
    },
  ): Promise<void> {
    const options = await this.policy.tryBuildOptions(
      piiRedactionLevel,
      lambda?.entities,
      lambda?.exceptPatterns,
    );
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
      attributeNames?: Record<string, string>;
    },
    piiRedactionLevel: PIIRedactionLevel,
    tenantId?: TenantId,
  ): Promise<void> {
    const native = await this.policy.tryResolveNativeContext(tenantId, piiRedactionLevel);
    if (!native) {
      await this.lambdaRedactMetricAttributes(metric, piiRedactionLevel);
      return;
    }
    if (this.policy.nativePassActive(native.policy)) {
      const compiled = this.policy.compileNativePatterns(native.policy);
      this.redactRecordNative({
        record: metric.attributes,
        policy: native.policy,
        compiled,
        attributeNames: metric.attributeNames,
      });
      this.redactRecordNative({
        record: metric.resourceAttributes,
        policy: native.policy,
        compiled,
      });
    }
    const lambda = this.policy.tryLambdaAfterNative(native.policy);
    if (lambda) {
      await this.lambdaRedactMetricAttributes(metric, "STRICT", {
        entities: lambda.entities,
        exceptPatterns: lambda.exceptPatterns,
      });
    }
  }

  private async lambdaRedactMetricAttributes(
    metric: {
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
    },
    piiRedactionLevel: PIIRedactionLevel,
    lambda?: {
      entities?: readonly string[];
      exceptPatterns?: readonly string[];
    },
  ): Promise<void> {
    const options = await this.policy.tryBuildOptions(
      piiRedactionLevel,
      lambda?.entities,
      lambda?.exceptPatterns,
    );
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
    entities?: readonly string[],
    exceptPatterns?: readonly string[],
  ): Promise<PIICheckOptions | null> {
    const disabled = this.deps.featureFlags
      ? await this.deps.featureFlags.isEnabled("ops_pii_strict_presidio_redaction_disabled", {
          kind: "system",
        })
      : false;
    if (disabled) return null;
    if (piiRedactionLevel === "DISABLED") return null;

    const piiEnforced = this.deps.isProduction;

    if (!this.deps.isLangevalsConfigured) {
      if (piiEnforced) {
        throw new Error("LANGEVALS_ENDPOINT is not set, PII check cannot be performed");
      }
      return null;
    }

    return {
      piiRedactionLevel,
      enforced: piiEnforced,
      mainMethod: "presidio",
      ...(entities && entities.length > 0 ? { entities } : {}),
      ...(exceptPatterns && exceptPatterns.length > 0 ? { exceptPatterns } : {}),
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

  private collectRecordEntries(batch: RedactionBatch, record: Record<string, string>): void {
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

    const results = await this.policy.clearBatch(batch.texts, options);

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

}
