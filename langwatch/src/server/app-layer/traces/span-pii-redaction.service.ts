import { env } from "~/env.mjs";
import {
  clearPII as defaultClearPII,
  type PIICheckOptions,
} from "~/server/background/workers/collector/piiCheck";
import {
  DEFAULT_PII_REDACTION_LEVEL,
  type PIIRedactionLevel,
} from "../../event-sourcing/pipelines/trace-processing/schemas/commands";
import type { OtlpKeyValue, OtlpSpan } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";

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

  constructor(deps: Partial<OtlpSpanPiiRedactionServiceDependencies> = {}) {
    this.deps = { ...getDefaultDependencies(), ...deps };
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

    // Redact only PII-bearing attributes in span
    this.collectPiiBearingAttributeRedactions(
      span.attributes,
      options,
      redactionPromises,
    );

    // Redact PII-bearing attributes in events
    for (const event of span.events) {
      this.collectPiiBearingAttributeRedactions(
        event.attributes,
        options,
        redactionPromises,
      );
    }

    // Redact PII-bearing attributes in links
    for (const link of span.links) {
      this.collectPiiBearingAttributeRedactions(
        link.attributes,
        options,
        redactionPromises,
      );
    }

    await Promise.all(redactionPromises);
  }

  /**
   * Collects redaction promises for attributes with PII-bearing keys.
   */
  private collectPiiBearingAttributeRedactions(
    attributes: OtlpKeyValue[],
    options: PIICheckOptions,
    promises: Promise<void>[],
  ): void {
    for (const attr of attributes) {
      if (
        this.deps.piiBearingAttributeKeys.has(attr.key) &&
        attr.value.stringValue !== undefined &&
        attr.value.stringValue !== null
      ) {
        promises.push(this.deps.clearPII(attr.value, ["stringValue"], options));
      }
    }
  }
}
