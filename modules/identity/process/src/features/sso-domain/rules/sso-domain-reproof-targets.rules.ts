import { isSsoPublishedProofChannel } from "@langwatch/identity-contract";
import { z } from "zod";

import type { SsoDomainReproofTarget } from "../repositories/sso-domain-reproof.repository.ts";

/**
 * One stored proof as a re-read needs it. Parsed rather than trusted: the
 * column is JSON, and a row written before ADR-123 carries no hash at all.
 */
const storedProofSchema = z.object({
  domain: z.string().min(1),
  method: z.string().min(1),
  tokenHash: z.string().min(1).nullish(),
});

/**
 * The targets one connection offers (ADR-123): a verified domain a published
 * channel proved, whose hash the row still carries. Everything else —
 * attested, licensed, grandfathered, pre-ADR-123 — published nothing.
 */
export function reproofTargetsOf({
  connectionId,
  organizationId,
  verifiedDomains,
  domainVerifications,
}: {
  connectionId: string;
  organizationId: string;
  verifiedDomains: readonly string[];
  domainVerifications: unknown;
}): SsoDomainReproofTarget[] {
  const stored = Array.isArray(domainVerifications) ? domainVerifications : [];

  return stored.flatMap((entry: unknown): SsoDomainReproofTarget[] => {
    const parsed = storedProofSchema.safeParse(entry);
    if (!parsed.success) return [];
    const { domain, method, tokenHash } = parsed.data;
    if (!tokenHash) return [];
    if (!isSsoPublishedProofChannel(method)) return [];
    if (!verifiedDomains.includes(domain)) return [];

    return [{ connectionId, organizationId, domain, tokenHash, method }];
  });
}
