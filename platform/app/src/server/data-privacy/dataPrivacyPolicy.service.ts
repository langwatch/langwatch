import { overBroadSecretPatternProbe } from "@langwatch/redaction";
import type { DataPrivacyPolicy } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { isSafeRegex } from "~/utils/safeRegex";
import {
  type DataPrivacyConfig,
  dataPrivacyConfigSchema,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedDataPrivacy,
} from "./dataPrivacy.types";
import { DataPrivacyPolicyCache } from "./dataPrivacyPolicy.cache";
import {
  DataPrivacyPolicyRepository,
  type DataPrivacyScope,
} from "./dataPrivacyPolicy.repository";

export class ScopeTargetNotFoundError extends Error {
  name = "ScopeTargetNotFoundError" as const;
}

export class InvalidDataPrivacyConfigError extends Error {
  name = "InvalidDataPrivacyConfigError" as const;
}

/**
 * Custom secret patterns and PII exception patterns are evaluated in the
 * ingestion hot path whenever their redaction pass runs (secrets scanning when
 * enabled; PII exceptions against detected PII spans), so a pattern must both
 * compile and pass the safe-regex (ReDoS) analysis before it is stored.
 * Rejecting at write time keeps that hot path free of per-event pattern
 * vetting.
 */
function assertSafePatterns(patterns: string[], label: string): void {
  for (const pattern of patterns) {
    try {
      new RegExp(pattern);
    } catch {
      throw new InvalidDataPrivacyConfigError(
        `${label} ${JSON.stringify(
          pattern,
        )} is not a valid regular expression.`,
      );
    }
    if (!isSafeRegex(pattern)) {
      throw new InvalidDataPrivacyConfigError(
        `${label} ${JSON.stringify(
          pattern,
        )} could backtrack catastrophically (ReDoS) and was rejected. ` +
          "Simplify the pattern (avoid nested quantifiers).",
      );
    }
  }
}

/**
 * A PII exception is the one pattern here that REMOVES redaction, so an
 * over-broad one fails open: compiled anchored as `^(?:pattern)$`, something
 * like `.*` or `\d+` matches every detected span and silently turns the whole
 * PII pass off while the UI still reports the level as active.
 *
 * The test is that the pattern cannot match a string of a kind it was not
 * written for: an exception exists to name a specific business identifier, so
 * it must not match both a digit run and a plain word.
 *
 * Secret patterns get their own breadth check below. They used to get none, on
 * the reasoning that a broad one "only over-redacts", but redaction happens at
 * ingestion and replaces the text for good, so over-redacting is data loss
 * rather than a cosmetic problem.
 */
const OVER_BROAD_EXCEPTION_PROBES = [
  "4111111111111111",
  "12345678901234",
  "someone@example.com",
  "Jane Doe",
  "+1 555 0100",
] as const;

function assertNotOverBroadExceptions(patterns: string[]): void {
  for (const pattern of patterns) {
    let anchored: RegExp;
    try {
      anchored = new RegExp(`^(?:${pattern})$`);
    } catch {
      // Compile failure already reported by assertSafePatterns.
      continue;
    }
    const matched = OVER_BROAD_EXCEPTION_PROBES.filter((probe) =>
      anchored.test(probe),
    );
    if (matched.length > 1) {
      throw new InvalidDataPrivacyConfigError(
        `PII exception pattern ${JSON.stringify(
          pattern,
        )} is too broad: it matches unrelated values (${matched
          .map((probe) => JSON.stringify(probe))
          .join(", ")}), so it would keep real personal data. ` +
          "Describe the specific identifier, including its length and any fixed prefix.",
      );
    }
  }
}

/**
 * A custom secret pattern runs unanchored against every string the pipeline
 * stores, and a match rewrites that text irreversibly. One broad enough to hit
 * ordinary prose therefore destroys trace content rather than protecting it,
 * which is what a pattern of `sk-.*` did to a customer's own transcripts.
 *
 * The probe compiles the pattern exactly as the ingestion path compiles it, so
 * the verdict here is the behaviour the customer would actually get.
 */
function assertNotOverBroadSecretPatterns(patterns: string[]): void {
  for (const pattern of patterns) {
    const eaten = overBroadSecretPatternProbe(pattern);
    if (eaten === null) continue;
    throw new InvalidDataPrivacyConfigError(
      `Custom secret pattern ${JSON.stringify(
        pattern.slice(0, 40),
      )} also matches ordinary text like ${JSON.stringify(eaten)}, ` +
        "so it would erase trace content. Give it the prefix or length the credential has.",
    );
  }
}

/**
 * A custom attribute pattern of only wildcards would match every span
 * attribute, and as a drop rule it would strip the observability metadata the
 * feature promises to always keep. Require at least one literal character.
 */
function assertSafeAttributePatterns(
  rules: Array<{ pattern: string }> | undefined,
): void {
  for (const rule of rules ?? []) {
    if (rule.pattern.replaceAll("*", "").length === 0) {
      throw new InvalidDataPrivacyConfigError(
        `Custom attribute pattern ${JSON.stringify(
          rule.pattern,
        )} matches every attribute; name at least part of the key.`,
      );
    }
  }
}

export class DataPrivacyPolicyService {
  constructor(
    private readonly repository: DataPrivacyPolicyRepository,
    private readonly cache: DataPrivacyPolicyCache,
  ) {}

  /**
   * The effective privacy policy a project resolves to today. Walks
   * PROJECT → DEPARTMENT → TEAM → ORGANIZATION per field, most-specific-wins.
   * When the project has no resolvable scope context the cache returns null;
   * we fall back to the platform default (capture + essential PII + secrets
   * redacted) because privacy is default-on. Delegates to the cache so the
   * resolution path has a single definition.
   */
  async getResolvedForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<ResolvedDataPrivacy> {
    const resolved = await this.cache.resolve(projectId);
    return resolved ?? PLATFORM_DEFAULT_DATA_PRIVACY;
  }

  /** Every privacy rule row in the organization (unfiltered). */
  async listOrganizationRules({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<DataPrivacyPolicy[]> {
    return this.repository.findAllInOrganization({ organizationId });
  }

  async getRowById(id: string): Promise<DataPrivacyPolicy | null> {
    return this.repository.findById(id);
  }

  /**
   * Set the privacy rule at one (scope, personalOnly) target. The caller
   * (router) must have already authorized manage on the scope. Validates the
   * config contract and every custom secret pattern, anchors the row to the
   * scope's owning organization, and invalidates the resolved cache for every
   * project the scope's cascade reaches.
   */
  async setForScope({
    scope,
    personalOnly,
    config,
  }: {
    scope: DataPrivacyScope;
    personalOnly: boolean;
    config: DataPrivacyConfig;
  }): Promise<DataPrivacyPolicy> {
    const parsed = dataPrivacyConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new InvalidDataPrivacyConfigError(
        `Invalid data-privacy config: ${parsed.error.message}`,
      );
    }
    assertSafePatterns(
      parsed.data.secrets?.customPatterns ?? [],
      "Custom secret pattern",
    );
    assertNotOverBroadSecretPatterns(parsed.data.secrets?.customPatterns ?? []);
    assertSafePatterns(
      parsed.data.pii?.exceptPatterns ?? [],
      "PII exception pattern",
    );
    assertNotOverBroadExceptions(parsed.data.pii?.exceptPatterns ?? []);
    assertSafeAttributePatterns(parsed.data.customAttributes);

    const organizationId =
      await this.repository.findOrganizationForScope(scope);
    if (!organizationId) {
      throw new ScopeTargetNotFoundError("Scope target not found.");
    }

    const row = await this.repository.upsertForScope({
      organizationId,
      scope,
      personalOnly,
      config: parsed.data,
    });

    await this.invalidateForScope({ scope, personalOnly });
    return row;
  }

  /** Remove the rule at one (scope, personalOnly) target; the next tier then applies. */
  async removeForScope({
    scope,
    personalOnly,
  }: {
    scope: DataPrivacyScope;
    personalOnly: boolean;
  }): Promise<void> {
    await this.repository.deleteForScope({ scope, personalOnly });
    await this.invalidateForScope({ scope, personalOnly });
  }

  private async invalidateForScope({
    scope,
    personalOnly,
  }: {
    scope: DataPrivacyScope;
    personalOnly: boolean;
  }): Promise<void> {
    const projectIds = await this.repository.findAffectedProjectIds({
      scope,
      personalOnly,
    });
    for (const id of projectIds) {
      this.cache.invalidate(id);
    }
  }
}

let singleton: DataPrivacyPolicyService | undefined;

/**
 * Process-wide service instance over the shared Prisma client, so the read
 * layer and routers share one cache. Constructed lazily to keep module load
 * free of database side effects.
 */
export function getDataPrivacyPolicyService(): DataPrivacyPolicyService {
  if (!singleton) {
    const repository = new DataPrivacyPolicyRepository(prisma);
    singleton = new DataPrivacyPolicyService(
      repository,
      new DataPrivacyPolicyCache(repository),
    );
  }
  return singleton;
}
