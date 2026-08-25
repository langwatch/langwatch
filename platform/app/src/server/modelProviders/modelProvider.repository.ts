import { generate } from "@langwatch/ksuid";
import type {
  ModelProvider,
  ModelProviderScope,
  PrismaClient,
} from "~/generated/prisma/client";
import { Prisma } from "~/generated/prisma/client";
import { KSUID_RESOURCES } from "../../utils/constants";
import { encrypt } from "../../utils/encryption";
import { resolveSingleOrganizationForScopes } from "../scopes/resolveOrganizationForScope";
import { resolveScopeChain } from "../scopes/resolveScopeChain";
import { readCustomKeys } from "./customKeys";
import type { CustomModelsInput } from "./customModel.schema";

/**
 * A ModelProvider row hydrated with its ModelProviderScope entries.
 * The `scopes` relation is the authoritative grant set — the `projectId`
 * column is kept only as a legacy pointer and does NOT imply access on
 * its own.
 */
export type ModelProviderWithScopes = ModelProvider & {
  scopes: ModelProviderScope[];
  /**
   * True when the row holds credentials that will not decrypt or parse.
   *
   * `customKeys` reads back as null in that case, the same as a row that holds
   * none, and this flag is the only thing that separates them. A write path
   * must not treat the two alike: one row has nothing to lose and the other
   * still holds ciphertext that a restored CREDENTIALS_SECRET would recover.
   */
  customKeysUnreadable?: boolean;
};

export type ScopeInput = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

/**
 * Repository for ModelProvider data access.
 *
 * Iter 109: the `(scopeType, scopeId)` columns moved to a
 * `ModelProviderScope` join table, so a single credential can now be
 * granted to N orgs/teams/projects. The repository's access resolver
 * walks that table; the `projectId` column remains as a legacy pointer
 * for backwards compatibility but carries no access semantics on its
 * own.
 */
/**
 * The legacy project-shaped predicate: "this provider type, granted to this
 * project". Shared so the delete and the pre-delete lookup that names the
 * rows for the gateway change feed can never drift apart.
 */
function byProviderInProject({
  provider,
  projectId,
}: {
  provider: string;
  projectId: string;
}): Prisma.ModelProviderWhereInput {
  return {
    provider,
    scopes: { some: { scopeType: "PROJECT", scopeId: projectId } },
  };
}

/**
 * The routing-handle field of a write, or nothing when the caller left it out.
 * Omitting keeps the stored handle; an explicit null clears it and releases
 * the name for another provider in the organization.
 */
function routingHandleWrite({
  routingHandle,
}: {
  routingHandle: string | null | undefined;
}): { routingHandle?: string | null } {
  return routingHandle === undefined ? {} : { routingHandle };
}

export class ModelProviderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(
    id: string,
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProviderWithScopes | null> {
    const client = tx ?? this.prisma;
    const result = await client.modelProvider.findFirst({
      where: {
        id,
        scopes: { some: { scopeType: "PROJECT", scopeId: projectId } },
      },
      include: { scopes: true },
    });
    return result ? this.withDecryptedKeys(result) : null;
  }

  async findByProvider(
    provider: string,
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProviderWithScopes | null> {
    const client = tx ?? this.prisma;
    const result = await client.modelProvider.findFirst({
      where: {
        provider,
        scopes: { some: { scopeType: "PROJECT", scopeId: projectId } },
      },
      include: { scopes: true },
    });
    return result ? this.withDecryptedKeys(result) : null;
  }

  /**
   * Find a ModelProvider by id anywhere inside an organization, regardless
   * of whether it is granted at the org, team, or a (possibly sibling)
   * project scope. The single-org `organizationId` anchor (ADR-021) bounds
   * the lookup to the caller's tenant, so an id from another org can't be
   * probed.
   *
   * The settings list surfaces org- and sibling-project-scoped rows (see
   * `findAllAccessibleForProject` / `findAllInOrganization`), so a
   * PROJECT-scope lookup misses them — which is why deleting an org-scoped
   * provider from a project view used to 404. The delete path uses this
   * org-anchored lookup and then gates the action on the per-scope manage
   * authz.
   */
  async findByIdForOrganization(
    id: string,
    organizationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProviderWithScopes | null> {
    const client = tx ?? this.prisma;
    const result = await client.modelProvider.findFirst({
      where: { id, organizationId },
      include: { scopes: true },
    });
    return result ? this.withDecryptedKeys(result) : null;
  }

  async findAll(
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProviderWithScopes[]> {
    const client = tx ?? this.prisma;
    const results = await client.modelProvider.findMany({
      where: {
        scopes: { some: { scopeType: "PROJECT", scopeId: projectId } },
      },
      include: { scopes: true },
    });
    return results.map((result) => this.withDecryptedKeys(result));
  }

  /**
   * Find every ModelProvider visible to a project under the multi-scope
   * ladder: a credential is visible when it has at least one scope entry
   * matching the project itself, the project's team, or the project's
   * organization.
   *
   * When the same provider string is bound multiple times in scope (e.g.
   * an ORG row and a PROJECT override), the narrower-scope row wins at
   * the reducer layer (see ModelProviderService). The repository itself
   * returns all rows so consumers that want the full set (gateway
   * binding picker, settings list page) can see everything.
   */
  async findAllAccessibleForProject(
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProviderWithScopes[]> {
    const client = tx ?? this.prisma;
    const project = await client.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        teamId: true,
        team: { select: { organizationId: true } },
      },
    });
    if (!project) return [];
    const results = await client.modelProvider.findMany({
      where: {
        scopes: {
          some: {
            OR: resolveScopeChain({
              organizationId: project.team.organizationId,
              teamId: project.teamId,
              projectId,
            }),
          },
        },
      },
      include: { scopes: true },
    });
    return results.map((result) => this.withDecryptedKeys(result));
  }

  /**
   * Every ModelProvider visible anywhere inside the given organization:
   * rows scoped at the org, at any of its teams, or at any of its
   * projects. Used by the "All you can see" model-providers page so a
   * user can see what an admin in a sibling project has configured (the
   * `findAllAccessibleForProject` view only shows rows whose scope set
   * intersects the currently-viewed project, which misses rows pinned
   * to sibling projects in the same org).
   */
  async findAllInOrganization(
    organizationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProviderWithScopes[]> {
    const client = tx ?? this.prisma;
    const teams = await client.team.findMany({
      where: { organizationId },
      select: { id: true, projects: { select: { id: true } } },
    });
    const teamIds = teams.map((t) => t.id);
    const projectIds = teams.flatMap((t) => t.projects.map((p) => p.id));
    const results = await client.modelProvider.findMany({
      where: {
        scopes: {
          some: {
            OR: [
              { scopeType: "ORGANIZATION", scopeId: organizationId },
              ...(teamIds.length > 0
                ? [{ scopeType: "TEAM" as const, scopeId: { in: teamIds } }]
                : []),
              ...(projectIds.length > 0
                ? [
                    {
                      scopeType: "PROJECT" as const,
                      scopeId: { in: projectIds },
                    },
                  ]
                : []),
            ],
          },
        },
      },
      include: { scopes: true },
    });
    return results.map((result) => this.withDecryptedKeys(result));
  }

  async create(
    data: {
      name: string;
      provider: string;
      enabled: boolean;
      customKeys?: Record<string, unknown> | null;
      customModels?: CustomModelsInput;
      customEmbeddingsModels?: CustomModelsInput;
      extraHeaders?: { key: string; value: string }[];
      /**
       * Scope grants for this credential. Every row must be accessible to
       * at least one (scopeType, scopeId) pair, and they are what the
       * organization anchor below is resolved from, so the caller decides
       * them. The service defaults the legacy single-scope path to the
       * project it wrote through.
       */
      scopes: ScopeInput[];
      /** Normalized routing handle, or null to store none. */
      routingHandle?: string | null;
      rateLimitRpm?: number | null;
      rateLimitTpm?: number | null;
      rateLimitRpd?: number | null;
      fallbackPriorityGlobal?: number | null;
      providerConfig?: Record<string, unknown> | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProviderWithScopes> {
    const client = tx ?? this.prisma;
    const encryptedKeys = this.encryptCustomKeys(data.customKeys ?? undefined);
    const { scopes } = data;
    if (scopes.length === 0) {
      throw new Error("Cannot create model provider: no scopes given");
    }

    // Single-organization anchor (ADR-021): every scope this provider attaches
    // to must resolve to the same org. Resolve them all and reject a mixed or
    // unresolvable set, so a caller can't slip in scopes from another org under
    // one anchor. The column is NOT NULL, so an unresolvable scope is a hard
    // error.
    const organizationId = await resolveSingleOrganizationForScopes(
      client,
      scopes,
      "model provider",
    );

    return client.modelProvider.create({
      data: {
        id: generate(KSUID_RESOURCES.MODEL_PROVIDER).toString(),
        name: data.name,
        provider: data.provider,
        enabled: data.enabled,
        organizationId,
        customKeys: encryptedKeys as Prisma.InputJsonValue | undefined,
        customModels: data.customModels as Prisma.InputJsonValue | undefined,
        customEmbeddingsModels: data.customEmbeddingsModels as
          | Prisma.InputJsonValue
          | undefined,
        extraHeaders: data.extraHeaders ?? [],
        ...routingHandleWrite({ routingHandle: data.routingHandle }),
        ...(data.rateLimitRpm !== undefined && {
          rateLimitRpm: data.rateLimitRpm,
        }),
        ...(data.rateLimitTpm !== undefined && {
          rateLimitTpm: data.rateLimitTpm,
        }),
        ...(data.rateLimitRpd !== undefined && {
          rateLimitRpd: data.rateLimitRpd,
        }),
        ...(data.fallbackPriorityGlobal !== undefined && {
          fallbackPriorityGlobal: data.fallbackPriorityGlobal,
        }),
        ...(data.providerConfig !== undefined && {
          // Explicit null on the input clears the column (Prisma.JsonNull
          // writes DB null to a Json? field). Bare `null` is rejected by
          // InputJsonValue, and `?? undefined` would silently turn a
          // "clear me" into a no-op.
          providerConfig:
            data.providerConfig === null
              ? Prisma.JsonNull
              : (data.providerConfig as Prisma.InputJsonValue),
        }),
        scopes: {
          create: scopes.map((scope) => ({
            id: generate(KSUID_RESOURCES.MODEL_PROVIDER_SCOPE).toString(),
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
          })),
        },
      },
      include: { scopes: true },
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      enabled?: boolean;
      customKeys?: Record<string, unknown>;
      customModels?: CustomModelsInput;
      customEmbeddingsModels?: CustomModelsInput;
      extraHeaders?: { key: string; value: string }[];
      /**
       * Replace the scope set atomically. When provided, all existing
       * ModelProviderScope rows for this MP are deleted and the new set
       * inserted; when omitted the scope set is untouched.
       */
      scopes?: ScopeInput[];
      /** Normalized routing handle. null clears it and releases the name. */
      routingHandle?: string | null;
      rateLimitRpm?: number | null;
      rateLimitTpm?: number | null;
      rateLimitRpd?: number | null;
      fallbackPriorityGlobal?: number | null;
      providerConfig?: Record<string, unknown> | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<ModelProviderWithScopes> {
    const encryptedKeys = this.encryptCustomKeys(data.customKeys);
    const { scopes, providerConfig, ...rest } = data;

    const runUpdate = async (workingTx: Prisma.TransactionClient) => {
      if (scopes) {
        // Single-organization invariant (ADR-021): the replacement scope set
        // must resolve to the same org the provider is already anchored to.
        // Without this, swapping scopes could silently rebind the credential to
        // another tenant while organizationId stays put — a multitenancy break,
        // since provider visibility is driven from the scope table.
        const organizationId = await resolveSingleOrganizationForScopes(
          workingTx,
          scopes,
          "model provider",
        );
        const existing = await workingTx.modelProvider.findUnique({
          where: { id },
          select: { organizationId: true },
        });
        if (existing && existing.organizationId !== organizationId) {
          throw new Error(
            "Cannot update model provider: scopes must stay within the provider's organization",
          );
        }
        await workingTx.modelProviderScope.deleteMany({
          where: { modelProviderId: id },
        });
        await workingTx.modelProviderScope.createMany({
          data: scopes.map((scope) => ({
            id: generate(KSUID_RESOURCES.MODEL_PROVIDER_SCOPE).toString(),
            modelProviderId: id,
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
          })),
        });
      }

      return workingTx.modelProvider.update({
        where: { id },
        data: {
          ...rest,
          customKeys: encryptedKeys as Prisma.InputJsonValue | undefined,
          customModels: data.customModels as Prisma.InputJsonValue | undefined,
          customEmbeddingsModels: data.customEmbeddingsModels as
            | Prisma.InputJsonValue
            | undefined,
          ...(providerConfig !== undefined && {
            providerConfig:
              providerConfig === null
                ? Prisma.JsonNull
                : (providerConfig as Prisma.InputJsonValue),
          }),
        },
        include: { scopes: true },
      });
    };

    // Reuse the caller's transaction when provided so scope replacement
    // is atomic with their other writes; otherwise spin our own.
    if (tx) return runUpdate(tx);
    return this.prisma.$transaction(runUpdate);
  }

  async delete(id: string, tx?: Prisma.TransactionClient): Promise<ModelProvider> {
    const client = tx ?? this.prisma;
    return client.modelProvider.delete({
      where: { id },
    });
  }

  /**
   * Removes the named rows that still match the provider-and-project scope.
   *
   * Both halves of that predicate matter, and they guard opposite races.
   *
   * The id list is what the caller resolved and is about to name to the
   * gateway change feed. Without it, a row that entered the scope after the
   * lookup would be deleted with no event to evict its cached credential.
   *
   * The scope predicate is re-applied because READ COMMITTED gives this
   * statement its own snapshot. Without it, a row whose project scope was
   * removed after the lookup would still be deleted, letting a caller remove
   * a provider they can no longer manage.
   *
   * The intersection is what survives both, so the delete is never wider than
   * either the caller's authorization or the set it can account for.
   */
  async deleteByIdsInProviderScope({
    ids,
    provider,
    projectId,
    tx,
  }: {
    ids: string[];
    provider: string;
    projectId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<Prisma.BatchPayload> {
    if (ids.length === 0) return { count: 0 };
    const client = tx ?? this.prisma;
    return client.modelProvider.deleteMany({
      where: {
        AND: [{ id: { in: ids } }, byProviderInProject({ provider, projectId })],
      },
    });
  }

  /**
   * Which of the given ids are still present. The caller subtracts this from
   * the set it tried to delete to learn exactly what went, since `deleteMany`
   * reports a count and nothing else and the gateway change feed needs one
   * event per provider id that actually disappeared.
   */
  async findSurvivingIds({
    ids,
    tx,
  }: {
    ids: string[];
    tx?: Prisma.TransactionClient;
  }): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const client = tx ?? this.prisma;
    const rows = await client.modelProvider.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  /**
   * The rows the legacy provider-and-project delete contract names, resolved
   * before the delete so the caller can both remove them and name them to the
   * gateway change feed.
   */
  async findIdsByProvider({
    provider,
    projectId,
    tx,
  }: {
    provider: string;
    projectId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<{ id: string; organizationId: string }[]> {
    const client = tx ?? this.prisma;
    return client.modelProvider.findMany({
      where: byProviderInProject({ provider, projectId }),
      select: { id: true, organizationId: true },
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Private encryption helpers
  // ─────────────────────────────────────────────────────────────────

  /**
   * One provider row by id with decrypted customKeys, or null. Serves the
   * internal token-refresh path, which addresses the row directly (the
   * gateway hands back the row id it was configured with) — tenant scoping
   * happened when the row id entered the gateway config.
   */
  async findByIdWithDecryptedKeys(id: string): Promise<ModelProviderWithScopes | null> {
    const provider = await this.prisma.modelProvider.findUnique({
      where: { id },
      include: { scopes: true },
    });
    return provider ? this.withDecryptedKeys(provider) : null;
  }

  /**
   * Replace a provider row's credential keys (encrypted at rest). Used by
   * the token-refresh path only — user-driven edits go through update().
   */
  async replaceCustomKeys(args: {
    id: string;
    customKeys: Record<string, unknown>;
  }): Promise<void> {
    // A required object always encrypts to a string; `?? undefined` only
    // narrows the helper's wider nullable signature for Prisma's Json input.
    await this.prisma.modelProvider.update({
      where: { id: args.id },
      data: {
        customKeys: this.encryptCustomKeys(args.customKeys) ?? undefined,
      },
    });
  }

  /**
   * Encrypts customKeys before storing in the database.
   * Serializes the object to JSON, then encrypts the JSON string.
   *
   * @returns Encrypted string, or null/undefined if input is null/undefined.
   */
  private encryptCustomKeys(
    customKeys: Record<string, unknown> | null | undefined,
  ): string | null | undefined {
    if (customKeys === null) return null;
    if (customKeys === undefined) return undefined;
    return encrypt(JSON.stringify(customKeys));
  }

  /**
   * Returns a copy of the ModelProvider with decrypted customKeys.
   * Preserves the `scopes` relation as-is.
   *
   * A row whose credentials will not decrypt (typically CREDENTIALS_SECRET
   * changed after the row was written) reads back with `customKeys: null` so
   * the providers list still loads and the operator can enter new keys, rather
   * than the whole query throwing and blocking the UI behind a 500. That makes
   * it look exactly like a row that stores no credentials, so
   * `customKeysUnreadable` carries the difference for the callers that have to
   * act on it.
   */
  private withDecryptedKeys(provider: ModelProviderWithScopes): ModelProviderWithScopes {
    const read = readCustomKeys(provider.customKeys);
    return {
      ...provider,
      customKeys: read.state === "read" ? (read.keys as Prisma.JsonValue) : null,
      customKeysUnreadable: read.state === "unreadable",
    };
  }
}
