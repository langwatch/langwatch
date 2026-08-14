import { generate } from "@langwatch/ksuid";
import type {
  ModelDefaultConfig,
  ModelDefaultConfigScope,
  ModelDefaultScopeType,
  Prisma,
  PrismaClient,
} from "~/generated/prisma/client";
import { KSUID_RESOURCES } from "../../utils/constants";
import { resolveSingleOrganizationForScopes } from "../scopes/resolveOrganizationForScope";

export type ModelDefaultsPrisma = PrismaClient | Prisma.TransactionClient;

export type ScopeAttachment = {
  scopeType: ModelDefaultScopeType;
  scopeId: string;
};

export type ConfigAtScope = Pick<
  ModelDefaultConfig,
  "id" | "config" | "createdAt"
>;

export type AttachedScope = Pick<
  ModelDefaultConfigScope,
  "id" | "scopeType" | "scopeId"
>;

/**
 * Repository for ModelDefaultConfig + ModelDefaultConfigScope data
 * access. Thin wrapper over Prisma: holds CRUD only. Business rules
 * (sanitising payload keys, advisory locking, upsert-by-scope, etc.)
 * stay in the service layer per `dev/docs/best_practices/repository-service.md`.
 *
 * Both tables get explicit KSUID ids at create time
 * (`KSUID_RESOURCES.MODEL_DEFAULT_CONFIG` / `_SCOPE`) rather than
 * leaning on the schema's `@default(nanoid())` fallback. Pattern
 * mirrors `ModelProviderRepository`, and is documented in
 * `dev/docs/best_practices/ksuids.md`.
 */
export class ModelDefaultsRepository {
  constructor(private readonly prisma: ModelDefaultsPrisma) {}

  /** Acquire a tx-scoped advisory lock over every default-models write
   * in one organization.
   *
   * A scope lock alone only covers the scopes a write attaches. Claiming
   * a scope also detaches, and sometimes deletes, whichever config held
   * it, and that config may hold scopes this transaction never locked,
   * so two writes could reach the same config rows through disjoint lock
   * sets and take row locks in opposite orders. Every config a claim can
   * touch is anchored to the same organization as the scope being
   * claimed (ADR-021), so one lock per organization covers all of them.
   *
   * Taken FIRST by every write path, before any scope lock, which is
   * what makes the order total and a lock cycle impossible. Writes are
   * rare admin actions, so serialising them per organization costs
   * nothing a user can perceive. */
  async lockOrganization(organizationId: string): Promise<void> {
    await this.prisma
      .$executeRaw`-- @tenancy: advisory-lock helper, organizationId bounded
SELECT pg_advisory_xact_lock(hashtextextended(${`mdc-org:${organizationId}`}, 0))`;
  }

  /** Acquire a tx-scoped advisory lock keyed by the (scopeType, scopeId)
   * pair so the read-then-write upsert path in `setRoleAtScope` /
   * `setFeatureAtScope` serialises across concurrent callers without
   * blocking unrelated scopes. Hashes the key with `hashtextextended`
   * to fit the lock's bigint. */
  async lockScope(
    scopeType: ModelDefaultScopeType,
    scopeId: string,
  ): Promise<void> {
    // -- @tenancy: advisory-lock helper; the lock key already carries
    // the (scopeType, scopeId) scope and the call site is bounded by
    // the caller's transaction. No tenancy predicate in the SQL itself
    // because there is no row read or write here.
    //
    // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns `void`, and
    // $queryRaw tries to deserialize that column ("Failed to deserialize
    // column of type 'void'" on Prisma 5.7 / Postgres). $executeRaw runs the
    // statement and reads only the command tag, so the void result never gets
    // decoded — the lock is still taken.
    await this.prisma
      .$executeRaw`-- @tenancy: advisory-lock helper, scopeType+scopeId bounded
SELECT pg_advisory_xact_lock(hashtextextended(${`mdc:${scopeType}:${scopeId}`}, 0))`;
  }

  /** Mint a fresh KSUID-prefixed id for a new config row. Exposed so
   * the service can pass the id to followups (lifts, logging) without
   * an extra round-trip. */
  newConfigId(): string {
    return generate(KSUID_RESOURCES.MODEL_DEFAULT_CONFIG).toString();
  }

  /** Mint a fresh KSUID-prefixed id for a scope attachment. */
  newScopeId(): string {
    return generate(KSUID_RESOURCES.MODEL_DEFAULT_CONFIG_SCOPE).toString();
  }

  /** Create a config + the supplied scope attachments in a single
   * statement. Both the parent and the children carry explicit
   * KSUIDs. */
  async create(params: {
    config: Record<string, string>;
    scopes: ScopeAttachment[];
    authorId: string | null;
  }): Promise<{ id: string }> {
    const id = this.newConfigId();
    // Single-organization anchor (ADR-021): every scope a config attaches to
    // must resolve to the same org. Resolve all of them up front and reject a
    // mixed or unresolvable set, so we never persist scope rows that disagree
    // with the anchor. The column is NOT NULL, so an unresolvable scope is a
    // hard error.
    const organizationId = await resolveSingleOrganizationForScopes(
      this.prisma,
      params.scopes,
      "model default config",
    );
    await this.prisma.modelDefaultConfig.create({
      data: {
        id,
        config: params.config,
        authorId: params.authorId,
        organizationId,
        scopes: {
          create: params.scopes.map((s) => ({
            id: this.newScopeId(),
            scopeType: s.scopeType,
            scopeId: s.scopeId,
          })),
        },
      },
      select: { id: true },
    });
    return { id };
  }

  /** Update a config row's JSON payload + authorId. Scope changes go
   * through `updateConfigScopes`, which needs a caller-held transaction
   * to stay atomic; this one is a single statement, so it needs none.
   *
   * `updateMany`, so a config a concurrent save already collected is a
   * no-op rather than a P2025 the caller would surface as an unknown
   * error. Callers check the row exists first, so this never hides a
   * plain wrong id. */
  async updateConfigPayload(params: {
    id: string;
    data: { config?: Record<string, string>; authorId?: string | null };
  }): Promise<void> {
    await this.prisma.modelDefaultConfig.updateMany({
      where: { id: params.id },
      data: params.data,
    });
  }

  /** Add/remove scope attachments for an existing config, with an
   * optional config-payload bump. The statements run sequentially on
   * this repository's client, so callers must hold a transaction (the
   * service's `withScopeTransaction` wrapper) for the write to stay
   * atomic. */
  async updateConfigScopes(params: {
    id: string;
    configPayload?: {
      config?: Record<string, string>;
      authorId?: string | null;
    };
    toAdd: ScopeAttachment[];
    toRemoveIds: string[];
  }): Promise<void> {
    // Single-organization invariant (ADR-021): newly attached scopes must
    // resolve to the same org the config is already anchored to. Otherwise this
    // path could attach cross-org or orphaned scopes while organizationId stays
    // pinned to the old tenant — the inconsistency create() now prevents.
    if (params.toAdd.length > 0) {
      const organizationId = await resolveSingleOrganizationForScopes(
        this.prisma,
        params.toAdd,
        "model default config",
      );
      const existing = await this.prisma.modelDefaultConfig.findUnique({
        where: { id: params.id },
        select: { organizationId: true },
      });
      if (existing && existing.organizationId !== organizationId) {
        throw new Error(
          "Cannot update model default config: scopes must stay within the config's organization",
        );
      }
    }
    await this.prisma.modelDefaultConfig.updateMany({
      where: { id: params.id },
      data: params.configPayload ?? {},
    });
    if (params.toAdd.length > 0) {
      await this.prisma.modelDefaultConfigScope.createMany({
        data: params.toAdd.map((s) => ({
          id: this.newScopeId(),
          configId: params.id,
          scopeType: s.scopeType,
          scopeId: s.scopeId,
        })),
      });
    }
    if (params.toRemoveIds.length > 0) {
      await this.prisma.modelDefaultConfigScope.deleteMany({
        where: { id: { in: params.toRemoveIds } },
      });
    }
  }

  /** Every scope attachment on OTHER configs for the given scopes:
   * the rows a claiming write detaches. */
  async findAttachmentsForScopes(
    scopes: ScopeAttachment[],
    opts: { exceptConfigId?: string } = {},
  ): Promise<Array<{ id: string; configId: string }>> {
    if (scopes.length === 0) return [];
    return this.prisma.modelDefaultConfigScope.findMany({
      where: {
        OR: scopes.map((s) => ({
          scopeType: s.scopeType,
          scopeId: s.scopeId,
        })),
        ...(opts.exceptConfigId
          ? { configId: { not: opts.exceptConfigId } }
          : {}),
      },
      select: { id: true, configId: true },
    });
  }

  /** Delete the given scope-attachment rows. Ids are sorted so two
   * writes over overlapping sets take their row locks in the same
   * order. */
  async deleteAttachments(attachmentIds: string[]): Promise<void> {
    if (attachmentIds.length === 0) return;
    await this.prisma.modelDefaultConfigScope.deleteMany({
      where: { id: { in: [...attachmentIds].sort() } },
    });
  }

  /** Delete any of the given configs that no longer have a single scope
   * attachment: an unattached config can never be hit by the resolver,
   * it just haunts the settings table. Ids are sorted for the same
   * reason as `deleteAttachments`. */
  async deleteConfigsWithoutScopes(configIds: string[]): Promise<void> {
    if (configIds.length === 0) return;
    await this.prisma.modelDefaultConfig.deleteMany({
      where: { id: { in: [...configIds].sort() }, scopes: { none: {} } },
    });
  }

  /** Delete a config row. ModelDefaultConfigScope rows cascade via the
   * FK so callers don't have to clean them up explicitly.
   *
   * `deleteMany`, not `delete`: a config the caller asked to remove can
   * already be gone, because a concurrent save claimed its last scope
   * and collected it. "Remove this config" is satisfied either way, and
   * `delete` would raise P2025 for the caller to surface as an unknown
   * error on a save that in fact succeeded. */
  async delete(configId: string): Promise<void> {
    await this.prisma.modelDefaultConfig.deleteMany({
      where: { id: configId },
    });
  }

  /** The organization a config is anchored to, or null when the config
   * is already gone. */
  async findOrganizationIdForConfig(configId: string): Promise<string | null> {
    const row = await this.prisma.modelDefaultConfig.findUnique({
      where: { id: configId },
      select: { organizationId: true },
    });
    return row?.organizationId ?? null;
  }

  /** The single organization a set of scopes resolves to (ADR-021).
   * Throws on an empty, unresolvable, or cross-organization set. */
  async organizationIdForScopes(scopes: ScopeAttachment[]): Promise<string> {
    return resolveSingleOrganizationForScopes(
      this.prisma,
      scopes,
      "model default config",
    );
  }

  /** Return every config currently attached at the given scope (newest
   * first by createdAt). The service's upsert path uses this to find
   * the "right" config to mutate. */
  async findConfigsAtScope(
    scopeType: ModelDefaultScopeType,
    scopeId: string,
  ): Promise<ConfigAtScope[]> {
    const attached = await this.prisma.modelDefaultConfigScope.findMany({
      where: { scopeType, scopeId },
      select: {
        config: { select: { id: true, config: true, createdAt: true } },
      },
    });
    attached.sort(
      (a, b) =>
        (b.config.createdAt?.getTime() ?? 0) -
        (a.config.createdAt?.getTime() ?? 0),
    );
    return attached.map((a) => a.config);
  }

  /** Return the current scope attachments for a config row — used by
   * the diff logic in `updateConfigScopes`. */
  async findScopesForConfig(configId: string): Promise<AttachedScope[]> {
    return this.prisma.modelDefaultConfigScope.findMany({
      where: { configId },
      select: { id: true, scopeType: true, scopeId: true },
    });
  }
}
