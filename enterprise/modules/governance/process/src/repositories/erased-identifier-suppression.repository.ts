// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

/** One digest of an erased identifier, never the identifier itself (ADR-128 §9 step 1). */
export interface ErasedIdentifierSuppressionRow {
  organizationId: string;
  provider: string;
  identifierHash: string;
}

/** The do-not-reimport list. */
export abstract class ErasedIdentifierSuppressionRepository {
  /** One organization's whole list — small, and read as a set by write paths. */
  abstract findAllByOrganization(input: {
    organizationId: string;
  }): Promise<ErasedIdentifierSuppressionRow[]>;
  /** Every row across every organization, for the shared snapshot. */
  abstract findAll(): Promise<ErasedIdentifierSuppressionRow[]>;
  /** Idempotent: erasing the same person twice, or two sharing an identifier, must not fail. */
  abstract recordAll(input: {
    organizationId: string;
    provider: string;
    identifierHashes: string[];
    erasedAt: Instant;
  }): Promise<number>;
}
