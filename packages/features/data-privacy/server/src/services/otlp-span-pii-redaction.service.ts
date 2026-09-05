/**
 * PII redaction over an OTLP span, harvested for a process composed from packages.
 * BYTE-FAITHFUL, SPAN HALF ONLY.
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
import { OtlpRecordPiiRedactionService } from "./otlp-record-pii-redaction.service";
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

export class OtlpSpanPiiRedactionService {
  static create(deps: OtlpSpanPiiRedactionServiceDependencies): OtlpSpanPiiRedactionService {
    return new OtlpSpanPiiRedactionService(deps);
  }

  private readonly deps: OtlpSpanPiiRedactionServiceDependencies;
  private readonly policy: PiiRedactionPolicyService;
  private readonly records: OtlpRecordPiiRedactionService;
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
    this.records = OtlpRecordPiiRedactionService.create({ deps: merged, policy: this.policy });
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
   * Native in-process pass over every string attribute, event/link attribute, status message,
   * and resource attribute of a span. Runs the secrets scrubber (when enabled) and
   * essential-PII recognizers (when the effective level is essential).
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
   * Redacts the span + resource in place. Native secrets + essential PII run in-process when a
   * policy is resolvable for the tenant; the strict level and any custom level that selected
   * analysis-service identifiers escalate to the batch for those.
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
        // Mark the span only when strict could not run because the analysis service is
        // genuinely unavailable (not configured in dev): the native floor redacted the
        // pattern-based identifiers but names/locations slip through, so the read path warns
        // instead of implying it is fully scrubbed.
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
   * The analysis-service batch path for spans: collects all string values from span attributes,
   * events, links, status.message, and resource attributes, then sends them in a single batch
   * to the PII detection service.
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
   * Every string this span offers the analysis service, with the budget enforced across all of
   * them: attribute sets first, then the status message, then the resource.
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
       * The real OTLP attribute name behind each key of `attributes`, where the two differ.
       */
      attributeNames?: Record<string, string>;
    },
    piiRedactionLevel: PIIRedactionLevel,
    tenantId?: TenantId,
  ): Promise<void> {
    await this.records.redactLog(log, piiRedactionLevel, tenantId);
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
    await this.records.redactMetricAttributes(metric, piiRedactionLevel, tenantId);
  }
}
