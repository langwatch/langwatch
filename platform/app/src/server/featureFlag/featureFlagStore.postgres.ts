import { createLogger } from "@langwatch/observability";
import { prisma } from "../db";
import { TtlCache } from "../utils/ttlCache";
import { KILL_SWITCH_CACHE_TTL_MS } from "./constants";
import { type FeatureFlagKey, resolveFlagDefinition } from "./registry";
import {
  evaluateRules,
  type FeatureFlagRules,
  parseRules,
  type RuleEvaluationContext,
  readNeedsOrganizationAge,
} from "./rules";

/**
 * Postgres-backed flag value store with a thin Redis/in-memory cache.
 *
 * The store sits in front of the FeatureFlag Prisma table. Resolution
 * order at the service layer is `env -> store.get() -> registry.default`
 * for SYSTEM flags; this class is the middle hop.
 *
 * Caching uses the existing TtlCache (Redis primary, per-pod memory
 * fallback) at `KILL_SWITCH_CACHE_TTL_MS` (60 s). That window is chosen
 * to match the existing kill-switch TTL: an operator flipping a flag
 * from the Ops UI sees it propagate cluster-wide within a minute, and
 * misses fall back to a single SELECT against postgres per pod per
 * minute per flag, orders of magnitude below the PostHog cost the
 * SYSTEM scope is replacing.
 *
 * The cached value is the row itself ({ enabled, rules }), not a
 * pre-evaluated boolean. Targeting-rule evaluation happens per call
 * against the caller's `{ projectId, organizationId }` context, so a
 * single cache entry serves every tenant — no per-context cache key
 * fan-out (which is what drove the 2026-05 PostHog spike). "Not set"
 * stays a distinct state (null row) so a cache hit for an absent row
 * doesn't shadow a registry default with `false`.
 *
 * One rule kind needs more than the caller hands over: a "new users" rule
 * compares the organization's creation date. That date is fetched here,
 * lazily and only for a flag whose own rules ask for it, so no call site has
 * to carry it and no flag without such a rule pays for a lookup.
 */
type CachedRow = { enabled: boolean; rules: FeatureFlagRules } | null;
type CacheSlot = { row: CachedRow };

const CACHE_PREFIX = "feature_flag_store:v2:";
const LOCAL_TTL_MS = 5_000;
const LOCAL_MAX_KEYS = 5_000;

/**
 * An organization's creation date never changes, so this cache exists only
 * to bound how many rows a pod holds, not to bound staleness. It is
 * deliberately longer than the flag row's own window: an operator editing an
 * age rule must see the new rule within a cache window, but the dates it
 * compares against are immutable history.
 */
const ORG_CREATED_AT_TTL_MS = 10 * 60_000;
const ORG_CREATED_AT_MAX_KEYS = 10_000;

export class FeatureFlagStorePostgres {
  private readonly logger = createLogger("langwatch:feature-flag-store");
  private readonly cache = new TtlCache<CacheSlot>(
    KILL_SWITCH_CACHE_TTL_MS,
    CACHE_PREFIX,
  );
  // Per-pod in-process cache. Sits in front of Redis so the trace-
  // processing subscriber (called per event) does not generate a Redis GET
  // per event.
  private readonly local = new Map<
    string,
    { row: CachedRow; expiresAt: number }
  >();
  // Creation dates of organizations named by an age rule. Separate from
  // `local` because it is keyed by organization rather than by flag, and
  // because its entries outlive a flag-row cache window.
  private readonly organizationCreatedAt = new Map<
    string,
    { createdAt: Date | null; expiresAt: number }
  >();

  /**
   * Resolve `key` against the calling context. Returns `null` when no
   * postgres row exists (caller should fall through to the registry
   * default). When a row exists, targeting rules are evaluated first;
   * the row-level `enabled` is the fallback if no rule matches.
   */
  async get(
    key: string,
    ctx: RuleEvaluationContext = {},
  ): Promise<boolean | null> {
    const row = await this.getRow(key);
    if (row === null) return null;
    const ruleHit = evaluateRules(
      row.rules,
      await this.withOrganizationAge(row.rules, ctx),
    );
    return ruleHit ?? row.enabled;
  }

  /**
   * Fills in `organizationCreatedAt` for a read whose flag carries a "new
   * users" rule, so the caller never has to know the rule exists.
   *
   * Every flag read would otherwise have to carry the organization's
   * creation date, which means every call site — including the per-event
   * kill-switch path — paying for a lookup no rule asks for. Instead the
   * date is resolved here, only when this flag's own rules name it, and
   * cached per organization. A flag with no age rule reads exactly what it
   * read before.
   */
  private async withOrganizationAge(
    rules: FeatureFlagRules,
    ctx: RuleEvaluationContext,
  ): Promise<RuleEvaluationContext> {
    if (ctx.organizationCreatedAt !== undefined) return ctx;
    if (!ctx.organizationId) return ctx;
    if (!readNeedsOrganizationAge({ rules, ctx })) return ctx;
    return {
      ...ctx,
      organizationCreatedAt: await this.getOrganizationCreatedAt(
        ctx.organizationId,
      ),
    };
  }

  /**
   * Reads an organization's creation date, memoised per pod. A failed read
   * resolves to null, which matches no age rule — the same fail-closed
   * choice the matcher makes for an unknown date, so a database blip cannot
   * hand a rollout to organizations it excludes.
   */
  private async getOrganizationCreatedAt(
    organizationId: string,
  ): Promise<Date | null> {
    const now = Date.now();
    const cached = this.organizationCreatedAt.get(organizationId);
    if (cached && cached.expiresAt > now) return cached.createdAt;
    try {
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { createdAt: true },
      });
      const createdAt = organization?.createdAt ?? null;
      this.rememberOrganizationCreatedAt(organizationId, createdAt, now);
      return createdAt;
    } catch (error) {
      this.logger.warn(
        {
          organizationId,
          error: error instanceof Error ? error.message : error,
        },
        "organization creation date lookup failed, age rules will not match",
      );
      // Deliberately not cached: a failed read is a blip, not an answer, and
      // caching it would extend one bad minute across the whole TTL.
      return null;
    }
  }

  private rememberOrganizationCreatedAt(
    organizationId: string,
    createdAt: Date | null,
    now: number,
  ): void {
    if (this.organizationCreatedAt.size >= ORG_CREATED_AT_MAX_KEYS) {
      this.evictOrganizationCreatedAt(now);
    }
    this.organizationCreatedAt.set(organizationId, {
      createdAt,
      expiresAt: now + ORG_CREATED_AT_TTL_MS,
    });
  }

  /**
   * A Map iterates in insertion order, so the fallback here drops the oldest
   * entry rather than the least recently used one. That is the intended
   * trade: tracking recency would mean writing to the map on every read, and
   * the entry being protected is a date that is only worth a query anyway.
   */
  private evictOrganizationCreatedAt(now: number): void {
    for (const [id, entry] of this.organizationCreatedAt) {
      if (entry.expiresAt <= now) this.organizationCreatedAt.delete(id);
    }
    if (this.organizationCreatedAt.size < ORG_CREATED_AT_MAX_KEYS) return;
    const oldest = this.organizationCreatedAt.keys().next();
    if (!oldest.done) this.organizationCreatedAt.delete(oldest.value);
  }

  /**
   * Same resolution as `get`, but an absent row resolves to the flag's
   * registry default instead of `null`.
   *
   * For hot-path callers that must decide without going through
   * `FeatureFlagService`: reading `get` directly makes an absent row read as
   * "off" and silently strands the registry default, so a flag that ships on
   * by default would never reach a deployment that has not written an
   * operator row. This method is the resolution those callers actually want
   * — operator row (with its targeting rules) first, registry default
   * second — without paying the service layer's per-call overhead (env
   * override parsing, force-enable list split) on a per-span hot path.
   */
  async getOrRegistryDefault(
    key: FeatureFlagKey,
    ctx: RuleEvaluationContext = {},
  ): Promise<boolean> {
    const stored = await this.get(key, ctx);
    if (stored !== null) return stored;
    return resolveFlagDefinition(key)?.defaultValue ?? false;
  }

  /**
   * Bypass rule evaluation and return the raw row (or null when
   * absent). Used by the Ops UI to render the row-level toggle and
   * the rules editor against the same cache. Same TTLs as `get`.
   */
  async getRow(
    key: string,
  ): Promise<{ enabled: boolean; rules: FeatureFlagRules } | null> {
    const localHit = this.local.get(key);
    const now = Date.now();
    if (localHit) {
      if (localHit.expiresAt > now) return localHit.row;
      this.local.delete(key);
    }
    const cached = await this.cache.get(key);
    if (cached !== undefined) {
      this.writeLocal(key, cached.row, now);
      return cached.row;
    }
    try {
      const dbRow = await prisma.featureFlag.findUnique({
        where: { key },
        select: { enabled: true, rules: true },
      });
      const row: CachedRow = dbRow
        ? { enabled: dbRow.enabled, rules: parseRules(dbRow.rules) }
        : null;
      await this.cache.set(key, { row });
      this.writeLocal(key, row, now);
      return row;
    } catch (error) {
      this.logger.warn(
        { key, error: error instanceof Error ? error.message : error },
        "feature flag store read failed, falling back to registry default",
      );
      return null;
    }
  }

  private writeLocal(key: string, row: CachedRow, now: number): void {
    this.local.set(key, { row, expiresAt: now + LOCAL_TTL_MS });
    if (this.local.size <= LOCAL_MAX_KEYS) return;
    for (const [k, v] of this.local) {
      if (v.expiresAt <= now) this.local.delete(k);
    }
    if (this.local.size <= LOCAL_MAX_KEYS) return;
    const overflow = this.local.size - LOCAL_MAX_KEYS;
    let dropped = 0;
    for (const k of this.local.keys()) {
      this.local.delete(k);
      dropped += 1;
      if (dropped >= overflow) break;
    }
  }

  /**
   * Operator write of the row-level enabled value (the rule-fallback
   * default). Existing rules are preserved on update.
   */
  async set(
    key: string,
    enabled: boolean,
    lastEditedBy: string | null,
  ): Promise<void> {
    await prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled, lastEditedBy },
      update: { enabled, lastEditedBy },
    });
    await this.invalidate(key);
  }

  /**
   * Operator write of the targeting rules for a flag.
   *
   * A rule is an override for the targets it names, and for nobody else.
   * When no row exists yet, the row this creates seeds its row-level
   * `enabled` from the registry default so unmatched callers keep resolving
   * to exactly what they resolved to before the rule was written. Seeding
   * `false` unconditionally would make a single per-project opt-out rule
   * switch a default-on flag off for the whole fleet, since the new row
   * shadows the registry default for every non-matching context.
   *
   * For a default-off flag the seed is `false`, so an org-scoped enable
   * still cannot flip the flag on cluster-wide. Unregistered keys seed
   * `false` for the same reason.
   */
  async setRules(
    key: string,
    rules: FeatureFlagRules,
    lastEditedBy: string | null,
  ): Promise<void> {
    await prisma.featureFlag.upsert({
      where: { key },
      create: {
        key,
        enabled: resolveFlagDefinition(key)?.defaultValue ?? false,
        rules: rules as unknown as object,
        lastEditedBy,
      },
      update: { rules: rules as unknown as object, lastEditedBy },
    });
    await this.invalidate(key);
  }

  async clear(key: string, lastEditedBy: string | null): Promise<void> {
    await prisma.featureFlag.deleteMany({ where: { key } });
    await this.invalidate(key);
    this.logger.debug({ key, lastEditedBy }, "feature flag cleared");
  }

  /**
   * Bulk read for the Ops UI listing. Returns every row currently in
   * postgres regardless of registry status, so operators can see
   * orphaned rows from removed flags and clean them up.
   */
  async listAll(): Promise<
    Array<{
      key: string;
      enabled: boolean;
      rules: FeatureFlagRules;
      lastEditedBy: string | null;
      updatedAt: Date;
    }>
  > {
    const rows = await prisma.featureFlag.findMany({
      select: {
        key: true,
        enabled: true,
        rules: true,
        lastEditedBy: true,
        updatedAt: true,
      },
      orderBy: { key: "asc" },
    });
    return rows.map((r) => ({ ...r, rules: parseRules(r.rules) }));
  }

  private async invalidate(key: string): Promise<void> {
    await this.cache.delete(key);
    this.local.delete(key);
  }
}

let _instance: FeatureFlagStorePostgres | null = null;
export function getFeatureFlagStore(): FeatureFlagStorePostgres {
  if (!_instance) {
    _instance = new FeatureFlagStorePostgres();
  }
  return _instance;
}
