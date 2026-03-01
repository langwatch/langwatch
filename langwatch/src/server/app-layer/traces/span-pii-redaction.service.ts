import { env } from "~/env.mjs";
import {
  clearPII as defaultClearPII,
  type PIICheckOptions,
} from "~/server/background/workers/collector/piiCheck";
import { createLogger } from "~/utils/logger/server";
import {
  DEFAULT_PII_REDACTION_LEVEL,
  type PIIRedactionLevel,
} from "../../event-sourcing/pipelines/trace-processing/schemas/commands";
import type { OtlpKeyValue, OtlpSpan } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import { ATTR_KEYS } from "./canonicalisation/extractors/_constants";

/**
 * Default attribute keys known to contain PII-bearing content.
 * Only these keys are scanned for PII to minimize processing cost.
 */
export const DEFAULT_PII_BEARING_ATTRIBUTE_KEYS = new Set([
  // OpenTelemetry GenAI semantic conventions (legacy)
  "gen_ai.prompt",
  "gen_ai.completion",
  "gen_ai.input.messages",
  "gen_ai.output.messages",
  // OpenTelemetry GenAI semantic conventions (latest)
  "gen_ai.request.input_messages",
  "gen_ai.response.output_messages",
  // LangWatch conventions
  "langwatch.input",
  "langwatch.output",
  // OpenInference conventions
  "input.value",
  "output.value",
]);

/**
 * Maximum attribute value length (in characters) for PII redaction.
 * Matches the Presidio truncation limit in piiCheck.ts — values beyond this
 * are only partially scanned anyway, so skip the expensive call entirely.
 */
export const DEFAULT_PII_REDACTION_MAX_ATTRIBUTE_LENGTH = 250_000;

/**
 * Function type for PII clearing.
 */
export type ClearPIIFunction = (
  object: Record<string | number, unknown>,
  keysPath: (string | number)[],
  options: PIICheckOptions,
) => Promise<void>;

/**
 * Dependencies for OtlpSpanPiiRedactionService that can be injected for testing.
 */
export interface OtlpSpanPiiRedactionServiceDependencies {
  /** Function to clear PII from objects */
  clearPII: ClearPIIFunction;
  /** Set of attribute keys known to contain PII-bearing content */
  piiBearingAttributeKeys: Set<string>;
  /** Whether LANGEVALS_ENDPOINT is configured (truthy check) */
  isLangevalsConfigured: boolean;
  /** Whether running in production (NODE_ENV === "production") */
  isProduction: boolean;
  /** Maximum attribute value length for PII redaction; values exceeding this are skipped */
  piiRedactionMaxAttributeLength: number;
}

/** Cached default dependencies, lazily initialized */
let cachedDefaultDependencies: OtlpSpanPiiRedactionServiceDependencies | null =
  null;

function getDefaultDependencies(): OtlpSpanPiiRedactionServiceDependencies {
  if (!cachedDefaultDependencies) {
    cachedDefaultDependencies = {
      clearPII: defaultClearPII,
      piiBearingAttributeKeys: DEFAULT_PII_BEARING_ATTRIBUTE_KEYS,
      isLangevalsConfigured: !!env.LANGEVALS_ENDPOINT,
      isProduction: env.NODE_ENV === "production",
      piiRedactionMaxAttributeLength:
        DEFAULT_PII_REDACTION_MAX_ATTRIBUTE_LENGTH,
    };
  }
  return cachedDefaultDependencies;
}

/**
 * Service responsible for redacting PII from OTLP span data.
 * Scans specific PII-bearing attribute keys and redacts detected PII.
 * This service should be applied BEFORE creating immutable events
 * in the event sourcing pipeline.
 */
export class OtlpSpanPiiRedactionService {
  private readonly deps: OtlpSpanPiiRedactionServiceDependencies;
  private readonly logger = createLogger(
    "langwatch:trace-processing:span-pii-redaction-service",
  );

  constructor(deps: Partial<OtlpSpanPiiRedactionServiceDependencies> = {}) {
    const merged = { ...getDefaultDependencies(), ...deps };
    const maxLen = merged.piiRedactionMaxAttributeLength;
    merged.piiRedactionMaxAttributeLength =
      Number.isFinite(maxLen) && maxLen >= 0
        ? Math.floor(maxLen)
        : DEFAULT_PII_REDACTION_MAX_ATTRIBUTE_LENGTH;
    this.deps = merged;
  }

  /**
   * Redacts PII from specific PII-bearing attributes in the span.
   * Mutates the span in place for efficiency.
   *
   * Mirrors the PII redaction behavior from piiCheck.ts:
   * 1. Checks process.env.DISABLE_PII_REDACTION - if set, skips entirely
   * 2. Checks piiRedactionLevel !== "DISABLED" - if disabled, skips
   * 3. Checks LANGEVALS_ENDPOINT is set for presidio method
   * 4. Sets enforced: env.NODE_ENV === "production" - in prod, errors fail; otherwise warn and continue
   *
   * Only scans attributes with keys in piiBearingAttributeKeys to minimize cost.
   *
   * @param span - The OTLP span to redact
   * @param piiRedactionLevel - The project's PII redaction level
   */
  async redactSpan(
    span: OtlpSpan,
    piiRedactionLevel: PIIRedactionLevel,
  ): Promise<void> {
    // Mirror collectorWorker.ts behavior - check global disable first
    if (process.env.DISABLE_PII_REDACTION) {
      return;
    }

    if (piiRedactionLevel === "DISABLED") {
      return;
    }

    // In production, enforce PII redaction (errors fail); otherwise warn and continue
    const piiEnforced = this.deps.isProduction;

    // Mirror cleanupPIIs pre-check: presidio requires LANGEVALS_ENDPOINT
    if (!this.deps.isLangevalsConfigured) {
      if (piiEnforced) {
        throw new Error(
          "LANGEVALS_ENDPOINT is not set, PII check cannot be performed",
        );
      }
      // In non-production, skip PII check but allow processing to continue
      return;
    }

    const options: PIICheckOptions = {
      piiRedactionLevel,
      enforced: piiEnforced,
      mainMethod: "presidio",
    };

    const redactionPromises: Promise<void>[] = [];
    let anySkipped = false;
    let anyRedacted = false;

    // Redact only PII-bearing attributes in span
    const spanResult = this.collectPiiBearingAttributeRedactions(
      span.attributes,
      options,
      redactionPromises,
    );
    anySkipped = anySkipped || spanResult.skipped;
    anyRedacted = anyRedacted || spanResult.redacted;

    // Redact PII-bearing attributes in events
    for (const event of span.events) {
      const eventResult = this.collectPiiBearingAttributeRedactions(
        event.attributes,
        options,
        redactionPromises,
      );
      anySkipped = anySkipped || eventResult.skipped;
      anyRedacted = anyRedacted || eventResult.redacted;
    }

    // Redact PII-bearing attributes in links
    for (const link of span.links) {
      const linkResult = this.collectPiiBearingAttributeRedactions(
        link.attributes,
        options,
        redactionPromises,
      );
      anySkipped = anySkipped || linkResult.skipped;
      anyRedacted = anyRedacted || linkResult.redacted;
    }

    // Mark span with pii_redaction_status when any attributes were skipped
    if (anySkipped) {
      const statusValue = anyRedacted ? "partial" : "none";
      const existingIdx = span.attributes.findIndex(
        (a) => a.key === ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS,
      );
      if (existingIdx !== -1) {
        span.attributes[existingIdx]!.value.stringValue = statusValue;
      } else {
        span.attributes.push({
          key: ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS,
          value: { stringValue: statusValue },
        });
      }
    }

    await Promise.all(redactionPromises);
  }

  /**
   * Collects redaction promises for attributes with PII-bearing keys.
   * Returns { skipped, redacted } indicating whether any attributes were
   * skipped due to exceeding the max length, and whether any were sent for redaction.
   */
  private collectPiiBearingAttributeRedactions(
    attributes: OtlpKeyValue[],
    options: PIICheckOptions,
    promises: Promise<void>[],
  ): { skipped: boolean; redacted: boolean } {
    let skipped = false;
    let redacted = false;
    for (const attr of attributes) {
      if (
        this.deps.piiBearingAttributeKeys.has(attr.key) &&
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
        redacted = true;
        promises.push(this.deps.clearPII(attr.value, ["stringValue"], options));
      }
    }
    return { skipped, redacted };
  }
}
