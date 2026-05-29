import type {
  ModelDefaultConfig,
  ModelDefaultConfigScope,
  ModelDefaultScopeType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "../../utils/constants";
import { resolveOrganizationForScope } from "../scopes/resolveOrganizationForScope";

export type ModelDefaultsPrisma =
  | PrismaClient
  | Prisma.TransactionClient;

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

  /** Acquire a tx-scoped advisory lock keyed by the (scopeType, scopeId)
   * pair so the read-then-write upsert path in `setRoleAtScope` /
   * `setFeatureAtScope` serialises across concurrent callers without
   * blocking unrelated scopes. Hashes the key with `hashtextextended`
   * to fit the lock's bigint. */
  async lockScope(
    scopeType: ModelDefaultScopeType,
    scopeId: string,
  ): Promise<void> {
    await this.prisma
      .$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mdc:${scopeType}:${scopeId}`}, 0))`;
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
    // resolves to the same org, so the first scope is authoritative. The
    // column is NOT NULL, so an unresolvable scope is a hard error.
    const firstScope = params.scopes[0];
    const organizationId = firstScope
      ? await resolveOrganizationForScope(this.prisma, firstScope)
      : null;
    if (!organizationId) {
      throw new Error(
        "Cannot create model default config: scope does not resolve to an organization",
      );
    }
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

  /** Update a config row's JSON payload + authorId (no scope changes
   * here — that path needs the multi-statement `$transaction` form
   * which only the root PrismaClient exposes, see `updateConfigScopes`). */
  async updateConfigPayload(params: {
    id: string;
    data: { config?: Record<string, string>; authorId?: string | null };
  }): Promise<void> {
    await this.prisma.modelDefaultConfig.update({
      where: { id: params.id },
      data: params.data,
    });
  }

  /** Add/remove scope attachments for an existing config, atomically
   * with an optional config-payload bump. Requires a root PrismaClient
   * (transaction clients lack `$transaction`). The service-layer guard
   * enforces that contract. */
  async updateConfigScopes(params: {
    id: string;
    configPayload?: { config?: Record<string, string>; authorId?: string | null };
    toAdd: ScopeAttachment[];
    toRemoveIds: string[];
  }): Promise<void> {
    if (!("$transaction" in this.prisma)) {
      throw new Error(
        "ModelDefaultsRepository.updateConfigScopes requires a root PrismaClient, not a transaction client.",
      );
    }
    const prisma = this.prisma as PrismaClient;
    await prisma.$transaction([
      prisma.modelDefaultConfig.update({
        where: { id: params.id },
        data: params.configPayload ?? {},
      }),
      ...(params.toAdd.length > 0
        ? [
            prisma.modelDefaultConfigScope.createMany({
              data: params.toAdd.map((s) => ({
                id: this.newScopeId(),
                configId: params.id,
                scopeType: s.scopeType,
                scopeId: s.scopeId,
              })),
            }),
          ]
        : []),
      ...(params.toRemoveIds.length > 0
        ? [
            prisma.modelDefaultConfigScope.deleteMany({
              where: { id: { in: params.toRemoveIds } },
            }),
          ]
        : []),
    ]);
  }

  /** Delete a config row. ModelDefaultConfigScope rows cascade via the
   * FK so callers don't have to clean them up explicitly. */
  async delete(configId: string): Promise<void> {
    await this.prisma.modelDefaultConfig.delete({ where: { id: configId } });
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
