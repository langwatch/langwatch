// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The gate every push-mode receiver shares: throttle, then the bearer secret,
 * then the path's own source id, which must be the one the secret resolved to.
 */
import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import type { RateLimiter } from "@langwatch/process-stores/members";

import {
  extractClientIp,
  INGEST_RATE_LIMIT_MAX_REQUESTS,
  INGEST_RATE_LIMIT_WINDOW_SECONDS,
} from "../rules/governance-ingest-rate-limit.rules.ts";
import type { IngestionSourceService } from "./ingestion-source.service.ts";

const logger = createLogger("langwatch:ingest");

export type GovernanceIngestAuthorization =
  | Readonly<{ outcome: "authorized"; source: GovernanceIngestionSource }>
  | Readonly<{ outcome: "unauthorized" }>
  | Readonly<{ outcome: "rate-limited"; retryAfterSec: number }>;

export type GovernanceIngestAccessMembers = Readonly<{
  sources: Pick<IngestionSourceService, "findByIngestSecret">;
  /** The process's counter the per-caller throttle is kept in. */
  rateLimiter: RateLimiter;
  /** Main's `LW_INGEST_RATE_LIMIT_DISABLED` opt-out: nothing is counted and nobody is shed. */
  rateLimitDisabled: boolean;
}>;

/** What the receivers ask before they read a byte of a payload. */
export interface GovernanceIngestAccessApi {
  authorize: (input: {
    headers: Headers;
    sourceId: string;
  }) => Promise<GovernanceIngestAuthorization>;
}

export class GovernanceIngestAccessService implements GovernanceIngestAccessApi {
  private constructor(private readonly members: GovernanceIngestAccessMembers) {}

  static create(members: GovernanceIngestAccessMembers): GovernanceIngestAccessService {
    return new GovernanceIngestAccessService(members);
  }

  /**
   * The id check is what stops a valid secret from being pointed at another
   * source's endpoint, and it reports the same bare refusal an unknown secret
   * gets, so the answer never confirms that some other id exists.
   */
  async authorize(input: {
    headers: Headers;
    sourceId: string;
  }): Promise<GovernanceIngestAuthorization> {
    const throttled = await this.throttle(input.headers);

    if (throttled) return throttled;

    const source = await this.resolveSource(input.headers);

    if (!source || source.id !== input.sourceId) return { outcome: "unauthorized" };

    return { outcome: "authorized", source };
  }

  /** Wedged BEFORE the secret lookup, so scanners shed at the edge. */
  private async throttle(headers: Headers): Promise<GovernanceIngestAuthorization | null> {
    if (this.members.rateLimitDisabled) return null;

    const ip = extractClientIp(headers);
    const decision = await this.members.rateLimiter.check(`ingest:${ip}`, {
      requests: INGEST_RATE_LIMIT_MAX_REQUESTS,
      seconds: INGEST_RATE_LIMIT_WINDOW_SECONDS,
    });

    if (decision.allowed) return null;

    const retryAfterSec = decision.retryAfterSeconds ?? INGEST_RATE_LIMIT_WINDOW_SECONDS;
    logger.warn({ ip, retryAfterSec }, "ingest rate-limit exceeded; rejecting with 429");

    return { outcome: "rate-limited", retryAfterSec };
  }

  /**
   * Resolve `Authorization: Bearer <secret>` against the ingestion sources.
   * The regex runs first so a malformed header costs nothing, which is what
   * makes the throttle ahead of it worth having.
   */
  private async resolveSource(headers: Headers): Promise<GovernanceIngestionSource | null> {
    const header = headers.get("Authorization");

    if (!header) return null;

    const match = /^Bearer\s+(lw_is_[A-Za-z0-9_-]+)$/.exec(header.trim());

    if (!match?.[1]) return null;

    return this.members.sources.findByIngestSecret(match[1]);
  }
}
