// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { ErasureSecretMissingError } from "@langwatch/enterprise-governance-contract";
import { createLogger, type Logger } from "@langwatch/observability";

import type { ErasedIdentifierSuppressionRepository } from "../repositories/erased-identifier-suppression.repository.ts";
import type { GovernanceTenantHistoryRepository } from "../repositories/governance-tenant-history.repository.ts";
import { erasureDigest, getErasureSecret } from "../rules/erasure-digest.rules.ts";
import {
  type ErasureSuppressionCheck,
  NO_SUPPRESSION,
} from "../rules/erasure-suppression.rules.ts";
import type {
  SuppressionSnapshotData,
  SuppressionSnapshotService,
} from "./suppression-snapshot.service.ts";

/**
 * The check that makes an erasure hold (ADR-128 §9 step 1): what must never be re-imported,
 * as digests. Provider-scoped because dropping is destructive; the fold's check is
 * organization-wide because it substitutes. Spec: governance-identity-and-erasure.feature
 */
export class ErasureSuppressionService {
  private readonly suppressions: ErasedIdentifierSuppressionRepository;
  private readonly tenantHistory: GovernanceTenantHistoryRepository;
  private readonly erasureSecret: string | undefined;
  private readonly logger: Logger;

  private constructor(deps: {
    suppressions: ErasedIdentifierSuppressionRepository;
    tenantHistory: GovernanceTenantHistoryRepository;
    erasureSecret: string | undefined;
    logger: Logger;
  }) {
    this.suppressions = deps.suppressions;
    this.tenantHistory = deps.tenantHistory;
    this.erasureSecret = deps.erasureSecret;
    this.logger = deps.logger;
  }

  static create({
    suppressions,
    tenantHistory,
    erasureSecret,
    logger = createLogger("langwatch:governance:erasure-suppression"),
  }: {
    suppressions: ErasedIdentifierSuppressionRepository;
    tenantHistory: GovernanceTenantHistoryRepository;
    erasureSecret: string | undefined;
    logger?: Logger;
  }): ErasureSuppressionService {
    return new ErasureSuppressionService({ suppressions, tenantHistory, erasureSecret, logger });
  }

  /**
   * Fails OPEN, loudly: a transient fault must not become missing cost data. The list is read
   * BEFORE the secret — an absent secret is only unremarkable while the list is empty.
   */
  async loadForProvider({
    organizationId,
    provider,
  }: {
    organizationId: string;
    provider: string;
  }): Promise<ErasureSuppressionCheck> {
    let hashes: Set<string>;
    try {
      const rows = await this.suppressions.findAllByOrganization({ organizationId });
      hashes = new Set(
        rows.filter((row) => row.provider === provider).map((row) => row.identifierHash),
      );
    } catch (error) {
      this.logger.error(
        { error, organizationId, provider },
        "Could not read the erased-identifier suppression list; this run will not suppress anything, and an erased identifier may be re-imported",
      );
      return NO_SUPPRESSION;
    }

    if (hashes.size === 0) return NO_SUPPRESSION;

    let secret: string;
    try {
      secret = getErasureSecret({ secret: this.erasureSecret });
    } catch (error) {
      if (!(error instanceof ErasureSecretMissingError)) throw error;
      this.logger.error(
        { error, organizationId, provider, suppressedIdentifiers: hashes.size },
        "This organization has erased identifiers but this process has no erasure secret, so the list cannot be checked; this run will not suppress anything and an erased identifier may be re-imported. Set the same secret every other process uses — a split deployment where one side has it and the other does not produces exactly this",
      );
      return NO_SUPPRESSION;
    }

    return {
      isEmpty: false,
      isSuppressed: (identifier: string) =>
        identifier !== "" && hashes.has(erasureDigest({ secret, identifier })),
    };
  }

  /** The snapshot's loader: every suppression row and tenant, deployment-wide; provider dropped. */
  async loadSnapshot(): Promise<SuppressionSnapshotData> {
    const [suppressions, tenants] = await Promise.all([
      this.suppressions.findAll(),
      this.tenantHistory.findAll(),
    ]);
    const digestsByOrganization = new Map<string, Set<string>>();
    for (const row of suppressions) {
      const digests = digestsByOrganization.get(row.organizationId) ?? new Set<string>();
      digests.add(row.identifierHash);
      digestsByOrganization.set(row.organizationId, digests);
    }
    return {
      digestsByOrganization,
      organizationByTenant: new Map(tenants.map((row) => [row.tenantId, row.organizationId])),
    };
  }

  /** Main's `actorIdForRollupWrite`: the erased identifier's stand-in, substituted where the cell is keyed. */
  actorIdForRollupWrite({
    tenantId,
    rawActorId,
    snapshot,
  }: {
    tenantId: string;
    rawActorId: string;
    snapshot: Pick<
      SuppressionSnapshotService,
      "hasAnySuppressionForTenant" | "isSuppressedForTenant"
    >;
  }): string {
    if (rawActorId === "") return rawActorId;
    if (!snapshot.hasAnySuppressionForTenant(tenantId)) return rawActorId;
    let secret: string;
    try {
      secret = getErasureSecret({ secret: this.erasureSecret });
    } catch (error) {
      if (!(error instanceof ErasureSecretMissingError)) throw error;
      throw new Error(
        `Governance area ${tenantId} belongs to an organization that has erased somebody, but this process has no erasure secret, so the stand-in cannot be computed. Writing the identifier as it stands would put an erased person's address into the daily cost table. Set the same value every other process uses.`,
        { cause: error },
      );
    }
    const identifierHash = erasureDigest({ secret, identifier: rawActorId });
    return snapshot.isSuppressedForTenant({ tenantId, identifierHash })
      ? identifierHash
      : rawActorId;
  }
}
