import type { PIIRedactionLevel } from "@prisma/client";
import { env } from "~/env.mjs";
import {
  clearPII as defaultClearPII,
  type PIICheckOptions,
} from "~/server/background/workers/collector/piiCheck";
import type { OtlpKeyValue, OtlpSpan } from "../schemas/otlp";

/**
 * Attribute keys known to contain PII-bearing content.
 * Only these keys are scanned for PII to minimize processing cost.
 */
const PII_BEARING_ATTRIBUTE_KEYS = new Set([
  // OpenTelemetry GenAI semantic conventions (legacy)
  "gen_ai.prompt",
  "gen_ai.completion",
  "gen_ai.input.messages",
  "gen_ai.output.messages",
  // OpenTelemetry GenAI semantic conventions (latest)
  "gen_ai.request.messages",
  "gen_ai.response.messages",
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
  clearPII: ClearPIIFunction;
}

const defaultDependencies: OtlpSpanPiiRedactionServiceDependencies = {
  clearPII: defaultClearPII,
};

/**
 * Service responsible for redacting PII from OTLP span data.
 * Scans specific PII-bearing attribute keys and redacts detected PII.
 * This service should be applied BEFORE creating immutable events
 * in the event sourcing pipeline.
 */
export class OtlpSpanPiiRedactionService {
  private readonly deps: OtlpSpanPiiRedactionServiceDependencies;

  constructor(deps: Partial<OtlpSpanPiiRedactionServiceDependencies> = {}) {
    this.deps = { ...defaultDependencies, ...deps };
  }

  /**
   * Redacts PII from specific PII-bearing attributes in the span.
   * Mutates the span in place for efficiency.
   *
   * Mirrors collectorWorker.ts behavior:
   * 1. Checks process.env.DISABLE_PII_REDACTION - if set, skips entirely
   * 2. Checks piiRedactionLevel !== "DISABLED" - if disabled, skips
   * 3. Sets enforced: env.NODE_ENV === "production" - in prod, errors fail; otherwise warn and continue
   *
   * Only scans attributes with keys in PII_BEARING_ATTRIBUTE_KEYS to minimize cost.
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
    const piiEnforced = env.NODE_ENV === "production";

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
        PII_BEARING_ATTRIBUTE_KEYS.has(attr.key) &&
        attr.value.stringValue !== undefined &&
        attr.value.stringValue !== null
      ) {
        promises.push(
          this.deps.clearPII(attr.value, ["stringValue"], options),
        );
      }
    }
  }
}
