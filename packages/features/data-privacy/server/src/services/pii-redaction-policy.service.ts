/**
 * The privacy DECISIONS one span, log record or metric point is redacted
 * under, separated from the shape being redacted.
 *
 * Everything here is shape-independent: resolving the scope's policy,
 * reconciling it with the level the ingestion call asked for, deciding whether
 * the native pass has anything to do, deciding what the analysis service is
 * still needed for, and building the request it is asked with. The application
 * keeps all of it inside
 * `platform/app/src/server/app-layer/traces/span-pii-redaction.service.ts`,
 * where three public methods — one per OTLP shape — share it as private
 * members. It is separated here because the shapes convert on different
 * timetables: the trace conversion needs the span half, and the log and metric
 * conversions will need these same decisions and their own walkers. A second
 * copy of the escalation rules per shape is exactly the drift this whole
 * harvest exists to avoid.
 *
 * Every member below is the application's member, body for body. Two things
 * changed and nothing else: the visibility, because the walker is now a caller
 * rather than the same class, and the three names that answer with `null`
 * carry the `try` prefix this repository's `fallible-result-naming` policy
 * requires of a public method that can express absence. `null` means the same
 * thing it means in the application — no native context, no analysis call
 * needed, no analysis pass to make — and the prefix is what says so at the
 * seam rather than in a comment.
 */

import type {
  DataPrivacyService,
  PiiLevel,
  ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { PRIVACY_PII_INCOMPLETE_MARKER_ATTR } from "@langwatch/data-privacy-contract";
import type { TenantId } from "@langwatch/eventing";
import { STRICT_ONLY_PII_ENTITIES } from "@langwatch/redaction";
import {
  compilePolicyPiiExceptions,
  compilePolicySecretPatterns,
  nativePiiEntitiesForPolicy,
  redactAttributeNative,
  redactStringNative,
} from "@langwatch/redaction/pii";
import { type PIICheckOptions, PiiAnalysisPort } from "../ports/pii-analysis.port";

import { createLogger } from "@langwatch/observability";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";
import type { OtlpAnyValue, OtlpKeyValue, OtlpResource, OtlpSpan } from "@langwatch/trace-contract";
import { ATTR_KEYS } from "@langwatch/trace-contract";

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
/**
 * Dependencies for OtlpSpanPiiRedactionService that can be injected for testing.
 */
export interface OtlpSpanPiiRedactionServiceDependencies {
  transport: PiiAnalysisPort;
  isLangevalsConfigured: boolean;
  isProduction: boolean;
  nativePolicyEnforced: boolean;
  /** Maximum attribute value length for PII redaction; values exceeding this are skipped */
  piiRedactionMaxAttributeLength: number;
  /**
   * Resolves the scoped data-privacy policy for the native passes. Optional and
   * lazily defaulted to the process-wide service, so callers that never pass a
   * tenant (and most tests) don't need to provide it.
   */
  dataPrivacy: DataPrivacyService;
  featureFlags?: FeatureFlagService;
}

/**
 * Default batch PII clearing: uses Presidio batch API, falls back to individual Google DLP calls.
 */
const runGoogleDlpBatch = (
  transport: PiiAnalysisPort,
  texts: string[],
  piiRedactionLevel: PIIRedactionLevel,
  exceptPatterns?: readonly string[],
): Promise<(string | null)[]> =>
  Promise.all(
    texts.map(async (text) => {
      return await transport.tryClearGoogleDlp({
        text,
        piiRedactionLevel,
        exceptPatterns,
      });
    }),
  );

const batchClearPII = async (
  transport: PiiAnalysisPort,
  texts: string[],
  options: PIICheckOptions,
): Promise<(string | null)[]> => {
  const { piiRedactionLevel, mainMethod, entities, exceptPatterns } = options;

  if (mainMethod === "google_dlp") {
    return await runGoogleDlpBatch(transport, texts, piiRedactionLevel, exceptPatterns);
  }

  try {
    return await transport.clearPresidio(texts, piiRedactionLevel, entities);
  } catch {
    // The DLP fallback redacts by level, not by the custom entity subset; the
    // native pass already handled the pattern-based selections, so this only
    // ever widens the analysis-service entities on a presidio outage. The
    // policy's do-not-redact exceptions do carry over, so the fallback cannot
    // re-redact a value an exception kept.
    return await runGoogleDlpBatch(transport, texts, piiRedactionLevel, exceptPatterns);
  }
};

/**
 * Static defaults for PII service deps (no lazy caching, no mutable state).
 */

function requestLevelToPiiLevel(level: PIIRedactionLevel): PiiLevel {
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
 * The PII level to enforce, reconciling the resolved policy with the optional
 * per-request level carried on the ingestion command. A resolved level other
 * than the platform default ("essential") can only come from an explicit rule,
 * so it wins; at the default we honor the per-request level, so a single
 * ingestion call can still escalate or relax redaction without a policy rule.
 */
function reconcilePiiLevel(policyLevel: PiiLevel, requestLevel: PIIRedactionLevel): PiiLevel {
  if (policyLevel !== "essential") {
    return policyLevel;
  }

  return requestLevelToPiiLevel(requestLevel);
}

export class PiiRedactionPolicyService {
  static create(deps: OtlpSpanPiiRedactionServiceDependencies): PiiRedactionPolicyService {
    return new PiiRedactionPolicyService(deps);
  }

  private readonly logger = createLogger("langwatch:trace-processing:span-pii-redaction-service");

  private constructor(private readonly deps: OtlpSpanPiiRedactionServiceDependencies) {}

  /**
   * One analysis batch, sent by whichever method the options name: Presidio
   * for every strict and custom escalation, Google DLP when the options say so
   * or when Presidio is unreachable.
   */
  async clearBatch(texts: string[], options: PIICheckOptions): Promise<(string | null)[]> {
    return await batchClearPII(this.deps.transport, texts, options);
  }

  /**
   * Resolve the native-redaction context for a tenant: the effective policy
   * (PII level reconciled with the per-request level) and that level. Returns
   * null when native enforcement is skipped — the kill switch is set, no tenant
   * is known (older callers), or resolution failed — so the caller runs the
   * analysis-service batch path and PII is never silently left in.
   */
  async tryResolveNativeContext(
    tenantId: TenantId | undefined,
    requestLevel: PIIRedactionLevel,
  ): Promise<{ policy: ResolvedDataPrivacy; level: PiiLevel } | null> {
    if (!this.deps.nativePolicyEnforced) {
      return null;
    }

    if (!tenantId) {
      return null;
    }

    let resolved: ResolvedDataPrivacy;
    try {
      resolved = await this.deps.dataPrivacy.getResolvedForProject({ projectId: tenantId });
    } catch (error) {
      this.logger.warn(
        { error, tenantId },
        "Data-privacy resolution failed; falling back to the analysis-service PII path",
      );

      return null;
    }

    const level = reconcilePiiLevel(resolved.pii.level, requestLevel);

    return {
      policy: {
        ...resolved,
        pii: {
          level,
          entities: resolved.pii.entities,
          exceptPatterns: resolved.pii.exceptPatterns,
        },
      },
      level,
    };
  }

  /**
   * Whether the native pass would change anything for this policy: secrets
   * redaction is on, or there are native essential identifiers to scrub (every
   * essential/strict entity, or the native subset a custom level selected).
   */
  nativePassActive(policy: ResolvedDataPrivacy): boolean {
    if (policy.secrets.enabled) {
      return true;
    }

    const pii = nativePiiEntitiesForPolicy(policy);

    return pii === "all" || (Array.isArray(pii) && pii.length > 0);
  }

  /**
   * The analysis-service entities a resolved policy still needs after the native
   * pass. The custom level selects them explicitly; everything else native
   * already covered, so only these are sent out.
   */
  private customLambdaEntities(policy: ResolvedDataPrivacy): string[] {
    const selected = new Set(policy.pii.entities);

    return STRICT_ONLY_PII_ENTITIES.filter((entity) => selected.has(entity));
  }

  /**
   * The analysis-service call a resolved policy still needs after the native
   * pass: `{}` for strict (its default entity list), `{ entities }` for a custom
   * level that selected analysis-service identifiers, or null to skip it.
   *
   * When the policy carries PII exception patterns, the strict call is scoped
   * to the identifiers only the analysis service can detect (names, locations):
   * the native floor already ran every pattern-based recognizer WITH the
   * exceptions applied, and re-scanning those entities out-of-process would
   * re-redact the very values an exception kept (the service returns anonymized
   * text, so vetoes cannot be applied to its findings).
   *
   * Narrowing to name/location entities shrinks the blast radius, it does not
   * close the gap: `exceptPatterns` still rides along on the returned options
   * (tryBuildOptions), but `mainMethod` is always "presidio" here, and the
   * Presidio batch call has no way to honor them (see the doc-comment on
   * PIICheckOptions.exceptPatterns in piiCheck.ts). A name or location value
   * that fully matches an exception can still be redacted by this call. That
   * is a deliberate, tested contract, not a bug — see
   * span-pii-redaction.nativeScopedPolicy.test.ts's "strict-only exception
   * scoping" tests and the tooltip in data-privacy.tsx.
   */
  tryLambdaAfterNative(policy: ResolvedDataPrivacy): {
    entities?: readonly string[];
    exceptPatterns?: readonly string[];
  } | null {
    const exceptPatterns =
      policy.pii.exceptPatterns.length > 0 ? policy.pii.exceptPatterns : undefined;
    if (policy.pii.level === "strict") {
      return exceptPatterns ? { entities: STRICT_ONLY_PII_ENTITIES, exceptPatterns } : {};
    }

    if (policy.pii.level === "custom") {
      const entities = this.customLambdaEntities(policy);

      return entities.length > 0 ? { entities, exceptPatterns } : null;
    }

    return null;
  }

  private nativeSecretPatterns(policy: ResolvedDataPrivacy): readonly RegExp[] | undefined {
    return policy.secrets.enabled ? compilePolicySecretPatterns(policy) : undefined;
  }

  /**
   * Compile the per-policy patterns once for a whole native pass: the custom
   * secret patterns and the PII do-not-redact exceptions.
   */
  compileNativePatterns(policy: ResolvedDataPrivacy): {
    secrets: readonly RegExp[] | undefined;
    piiExceptions: readonly RegExp[] | undefined;
  } {
    return {
      secrets: this.nativeSecretPatterns(policy),
      piiExceptions:
        policy.pii.exceptPatterns.length > 0 ? compilePolicyPiiExceptions(policy) : undefined,
    };
  }

  /**
   * Returns PIICheckOptions for the redaction call, or null when redaction
   * should be skipped (disabled, no langevals in dev, etc). Throws when
   * langevals is required but unset in production.
   */
  async tryBuildOptions(
    piiRedactionLevel: PIIRedactionLevel,
    entities?: readonly string[],
    exceptPatterns?: readonly string[],
  ): Promise<PIICheckOptions | null> {
    const disabled = this.deps.featureFlags
      ? await this.deps.featureFlags.isEnabled("ops_pii_strict_presidio_redaction_disabled", {
          kind: "system",
        })
      : false;
    if (disabled) {
      return null;
    }

    if (piiRedactionLevel === "DISABLED") {
      return null;
    }

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
}
