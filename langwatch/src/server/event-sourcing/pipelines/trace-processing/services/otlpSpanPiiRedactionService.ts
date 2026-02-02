import type { PIIRedactionLevel, PrismaClient } from "@prisma/client";
import { env } from "~/env.mjs";
import { prisma as defaultPrisma } from "~/server/db";
import {
  clearPII as defaultClearPII,
  type PIICheckOptions,
} from "~/server/background/workers/collector/piiCheck";
import type { OtlpKeyValue, OtlpSpan } from "../schemas/otlp";

/**
 * Default PII redaction level when project settings are not available.
 * ESSENTIAL provides a safe default that protects user privacy.
 */
export const DEFAULT_PII_REDACTION_LEVEL: PIIRedactionLevel = "ESSENTIAL";

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
  /** Prisma client for fetching project PII settings */
  prisma: Pick<PrismaClient, "project">;
  /** Function to clear PII from objects */
  clearPII: ClearPIIFunction;
  /** Set of attribute keys known to contain PII-bearing content */
  piiBearingAttributeKeys: Set<string>;
}

/** Cached default dependencies, lazily initialized */
let cachedDefaultDependencies: OtlpSpanPiiRedactionServiceDependencies | null =
  null;

function getDefaultDependencies(): OtlpSpanPiiRedactionServiceDependencies {
  if (!cachedDefaultDependencies) {
    cachedDefaultDependencies = {
      prisma: defaultPrisma,
      clearPII: defaultClearPII,
      piiBearingAttributeKeys: DEFAULT_PII_BEARING_ATTRIBUTE_KEYS,
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
   * Redacts PII from a span for a given tenant.
   * Fetches the project's PII redaction settings and applies redaction.
   * Mutates the span in place for efficiency.
   *
   * @param span - The OTLP span to redact
   * @param tenantId - The project/tenant ID to fetch settings for
   */
  async redactSpanForTenant(span: OtlpSpan, tenantId: string): Promise<void> {
    const project = await this.deps.prisma.project.findUnique({
      where: { id: tenantId },
      select: { piiRedactionLevel: true },
    });

    const piiRedactionLevel =
      project?.piiRedactionLevel ?? DEFAULT_PII_REDACTION_LEVEL;

    await this.redactSpan(span, piiRedactionLevel);
  }

  /**
   * Redacts PII from specific PII-bearing attributes in the span.
   * Mutates the span in place for efficiency.
   *
   * Mirrors the PII redaction behavior from piiCheck.ts:
   * 1. Checks process.env.DISABLE_PII_REDACTION - if set, skips entirely
   * 2. Checks piiRedactionLevel !== "DISABLED" - if disabled, skips
   * 3. Sets enforced: env.NODE_ENV === "production" - in prod, errors fail; otherwise warn and continue
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
        this.deps.piiBearingAttributeKeys.has(attr.key) &&
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
