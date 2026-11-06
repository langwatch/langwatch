import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";

import { PII_REDACTION_MODEL_FLAG } from "../rules/pii-redaction-model.rules.ts";
import type { DataPrivacyProjectScopeService } from "./data-privacy-project-scope.service.ts";
import type { PresidioRedactionService } from "./presidio-redaction.service.ts";

const logger = createLogger("langwatch:data-privacy:pii-redaction-model");

/** A project's organization is read once per minute, as its privacy policy is. */
const ORGANIZATION_TTL_MS = 60_000;

/** One strict-analysis batch, as the redaction pass hands it to Presidio. */
type ModelClearInput = {
  texts: readonly string[];
  piiRedactionLevel: PIIRedactionLevel;
  entities?: readonly string[] | undefined;
  projectId?: string | undefined;
  spareNamesAndPlaces?: readonly boolean[] | undefined;
};

/**
 * The PII redaction model, for allowlisted organizations only. Every other batch, and every
 * batch the model fails, is left to today's Presidio-then-DLP path: this never answers a
 * failure with unredacted text or an empty result.
 */
export class PiiRedactionModelService {
  static create(input: {
    model: PresidioRedactionService;
    featureFlags: FeatureFlagApi;
    scopes: DataPrivacyProjectScopeService;
    now?: () => number;
  }): PiiRedactionModelService {
    return new PiiRedactionModelService({
      ...input,
      now: input.now ?? (() => nowInstant().epochMilliseconds),
    });
  }

  readonly #organizations = new Map<string, { organizationId: string; expiresAt: number }>();
  private readonly model: PresidioRedactionService;
  private readonly featureFlags: FeatureFlagApi;
  private readonly scopes: DataPrivacyProjectScopeService;
  private readonly now: () => number;

  private constructor(input: {
    model: PresidioRedactionService;
    featureFlags: FeatureFlagApi;
    scopes: DataPrivacyProjectScopeService;
    now: () => number;
  }) {
    this.model = input.model;
    this.featureFlags = input.featureFlags;
    this.scopes = input.scopes;
    this.now = input.now;
  }

  /** The model's clearing of one batch, or null when the batch stays on Presidio. */
  async findClearing(input: ModelClearInput): Promise<(string | null)[] | null> {
    const projectId = input.projectId;
    if (!projectId || !(await this.#isRoutedToModel({ projectId }))) return null;

    try {
      return await this.model.clear(input);
    } catch (error) {
      logger.warn(
        { projectId, reason: failureName(error) },
        "PII redaction model failed; falling back to Presidio",
      );
      return null;
    }
  }

  /** Configured first, so a deployment naming no model never asks the flag or the database. */
  async #isRoutedToModel({ projectId }: { projectId: string }): Promise<boolean> {
    try {
      if (!(await this.model.isConfigured())) return false;

      const organizationId = await this.#organizationOf({ projectId });
      return await this.featureFlags.isEnabled(PII_REDACTION_MODEL_FLAG, {
        kind: "project",
        projectId,
        organizationId,
      });
    } catch (error) {
      logger.warn(
        { projectId, reason: failureName(error) },
        "PII redaction model routing could not be decided; using Presidio",
      );
      return false;
    }
  }

  async #organizationOf({ projectId }: { projectId: string }): Promise<string> {
    const cached = this.#organizations.get(projectId);
    if (cached && cached.expiresAt > this.now()) return cached.organizationId;

    const { organizationId } = await this.scopes.getScopeFacts({ projectId });
    this.#organizations.set(projectId, {
      organizationId,
      expiresAt: this.now() + ORGANIZATION_TTL_MS,
    });
    return organizationId;
  }
}

/** The failure's class name only: a refusal's message may quote the analysed text. */
function failureName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
