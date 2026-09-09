/**
 * PII redaction over the flattened OTLP record shapes: log records and metric attributes.
 * The span half lives in `otlp-span-pii-redaction.service.ts`, which composes this one.
 */

import type { ResolvedDataPrivacy } from "@langwatch/data-privacy-contract";
import type { TenantId } from "@langwatch/eventing";
import { redactAttributeNative, redactStringNative } from "@langwatch/redaction/pii";
import { createLogger } from "@langwatch/observability";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";
import type { PIICheckOptions } from "../ports/pii-analysis.port.ts";
import type {
  OtlpSpanPiiRedactionServiceDependencies,
  PiiRedactionPolicyService,
} from "./pii-redaction-policy.service.ts";

/**
 * Accumulator used by the record-shaped redaction paths (logs, metrics). Tracks parallel arrays
 * of texts and back-references plus a cumulative length budget enforced by `tryPush`.
 */
type RedactionBatch = {
  texts: string[];
  refs: { obj: Record<string, string>; key: string }[];
  tryPush: (obj: Record<string, string>, key: string, value: string) => void;
};

export class OtlpRecordPiiRedactionService {
  static create(options: {
    deps: OtlpSpanPiiRedactionServiceDependencies;
    policy: PiiRedactionPolicyService;
  }): OtlpRecordPiiRedactionService {
    return new OtlpRecordPiiRedactionService(options.deps, options.policy);
  }

  private readonly logger = createLogger("langwatch:trace-processing:record-pii-redaction-service");

  private constructor(
    private readonly deps: OtlpSpanPiiRedactionServiceDependencies,
    private readonly policy: PiiRedactionPolicyService,
  ) {}

  /**
   * `record` may be keyed by an addressing path rather than by the attribute name (the log and
   * metric pipelines flatten a decoded OTLP tree into one).
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
        if (text !== value) {
          record[key] = text;
        }
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
    if (!this.policy.nativePassActive(policy)) {
      return;
    }

    const compiled = this.policy.compileNativePatterns(policy);
    if (log.body) {
      const { text } = redactStringNative({
        text: log.body,
        policy,
        compiledSecretPatterns: compiled.secrets,
        compiledPiiExceptions: compiled.piiExceptions,
      });
      if (text !== log.body) {
        log.body = text;
      }
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
       * The real OTLP attribute name behind each key of `attributes`, where the two differ.
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
    if (!options) {
      return;
    }

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
    if (!options) {
      return;
    }

    const batch = this.createRedactionBatch();
    this.collectRecordEntries(batch, metric.attributes);
    this.collectRecordEntries(batch, metric.resourceAttributes);

    await this.applyRedactionBatch(batch, options);
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
    if (batch.texts.length === 0) {
      return;
    }

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
