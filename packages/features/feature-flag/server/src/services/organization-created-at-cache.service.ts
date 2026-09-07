/**
 * Creation dates of organizations named by an age rule, memoised per process. Keyed by
 * organization rather than by flag, and outliving a flag-row cache window.
 */
import type { FeatureFlagRepository } from "../repositories/feature-flag.repository.ts";
import { nowInstant, type Instant } from "@langwatch/time";

/**
 * An organization's creation date never changes, so this window bounds how many rows a process
 * holds rather than how stale an answer may be.
 */
const ORGANIZATION_CREATED_AT_TTL_MS = 10 * 60_000;
const ORGANIZATION_CREATED_AT_MAX_KEYS = 10_000;

export class OrganizationCreatedAtCacheService {
  static create(options: { repository: FeatureFlagRepository }): OrganizationCreatedAtCacheService {
    return new OrganizationCreatedAtCacheService(options.repository);
  }

  private readonly organizationCreatedAt = new Map<
    string,
    { createdAt: Instant | null; expiresAt: number }
  >();

  private constructor(private readonly repository: FeatureFlagRepository) {}

  /**
   * Reads an organization's creation date, memoised per process. A failed read resolves to
   * null, which matches no age rule — the same fail-closed choice the matcher makes for an
   * unknown date, so a database blip cannot hand a rollout to organizations it excludes.
   */
  async tryGetCreatedAt(organizationId: string): Promise<Instant | null> {
    const now = nowInstant().epochMilliseconds;
    const cached = this.organizationCreatedAt.get(organizationId);
    if (cached && cached.expiresAt > now) {
      return cached.createdAt;
    }

    try {
      const createdAt = await this.repository.tryFindOrganizationCreatedAt(organizationId);
      this.rememberOrganizationCreatedAt({ organizationId, createdAt, now });

      return createdAt;
    } catch {
      // Deliberately not cached: a failed read is a blip, not an answer, and
      // caching it would extend one bad minute across the whole window.
      return null;
    }
  }

  private rememberOrganizationCreatedAt({
    organizationId,
    createdAt,
    now,
  }: {
    organizationId: string;
    createdAt: Instant | null;
    now: number;
  }): void {
    if (this.organizationCreatedAt.size >= ORGANIZATION_CREATED_AT_MAX_KEYS) {
      this.evictOrganizationCreatedAt(now);
    }

    this.organizationCreatedAt.set(organizationId, {
      createdAt,
      expiresAt: now + ORGANIZATION_CREATED_AT_TTL_MS,
    });
  }

  /**
   * A Map iterates in insertion order, so the fallback drops the oldest entry rather than the
   * least recently used one.
   */
  private evictOrganizationCreatedAt(now: number): void {
    for (const [id, entry] of this.organizationCreatedAt) {
      if (entry.expiresAt <= now) {
        this.organizationCreatedAt.delete(id);
      }
    }

    if (this.organizationCreatedAt.size < ORGANIZATION_CREATED_AT_MAX_KEYS) {
      return;
    }

    const oldest = this.organizationCreatedAt.keys().next();
    if (!oldest.done) {
      this.organizationCreatedAt.delete(oldest.value);
    }
  }
}
