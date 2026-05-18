import type { ModelDefaultScopeType, PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import {
  allFeatures,
  featureByKey,
  MODEL_ROLES,
  type ModelRole,
} from "./featureRegistry";

interface Ctx {
  prisma: PrismaClient | Prisma.TransactionClient;
}

export type ScopeAttachment = {
  scopeType: ModelDefaultScopeType;
  scopeId: string;
};

/**
 * Acquire a transaction-scoped Postgres advisory lock keyed by the
 * (scopeType, scopeId) pair. Serialises concurrent `setRoleAtScope` /
 * `setFeatureAtScope` calls at the same scope so the
 *   findMany → (create | update)
 * pattern can't race three concurrent provider-submit mutations into
 * three separate ModelDefaultConfig rows. The lock is held only for
 * the duration of the surrounding `$transaction`; unrelated scopes
 * (or unrelated orgs) never contend.
 *
 * `pg_advisory_xact_lock(bigint)` takes a 64-bit int; we hash the
 * scope key with Postgres' `hashtextextended` (deterministic, no
 * collisions in practice for the scope-id space) to get one.
 *
 * The bug this prevents: useProviderFormSubmit fans out 3 concurrent
 * mutations (DEFAULT / FAST / EMBEDDINGS) on the same scope. Without
 * the lock, all three see no existing config and each creates a fresh
 * one, leaving 3 separate ModelDefaultConfig rows attached to the
 * same scope. Caught on rchaves's 2026-05-18 dogfood.
 */
async function lockScope(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  scopeType: ModelDefaultScopeType,
  scopeId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mdc:${scopeType}:${scopeId}`}, 0))`;
}

/**
 * Allowed keys in a ModelDefaultConfig JSON: role names + every
 * feature key registered today. Anything else is silently dropped at
 * the write boundary so a typo can't leak into storage.
 */
function validKeySet(): Set<string> {
  const keys = new Set<string>();
  for (const role of MODEL_ROLES) keys.add(role as ModelRole);
  for (const f of allFeatures()) keys.add(f.key);
  return keys;
}

function sanitizeConfig(raw: Record<string, unknown>): Record<string, string> {
  const valid = validKeySet();
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!valid.has(key)) continue;
    if (typeof value !== "string") continue;
    if (value.length === 0) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * Create a new ModelDefaultConfig with its scope attachments. Empty
 * configs (no valid keys) are rejected — a config is meaningless
 * without at least one model assignment.
 */
export async function createConfig(
  ctx: Ctx,
  params: {
    config: Record<string, unknown>;
    scopes: ScopeAttachment[];
    authorId?: string | null;
  },
): Promise<{ id: string }> {
  const config = sanitizeConfig(params.config);
  if (Object.keys(config).length === 0) {
    throw new Error("ModelDefaultConfig must carry at least one role or feature key.");
  }
  if (params.scopes.length === 0) {
    throw new Error("ModelDefaultConfig must attach to at least one scope.");
  }
  // Deduplicate scope attachments before insert so a caller passing
  // the same (type,id) twice doesn't trip the unique index.
  const seen = new Set<string>();
  const scopes: ScopeAttachment[] = [];
  for (const s of params.scopes) {
    const key = `${s.scopeType}::${s.scopeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push(s);
  }

  const created = await ctx.prisma.modelDefaultConfig.create({
    data: {
      config,
      authorId: params.authorId ?? null,
      scopes: { create: scopes.map((s) => ({ scopeType: s.scopeType, scopeId: s.scopeId })) },
    },
    select: { id: true },
  });
  return { id: created.id };
}

/**
 * Update a config's JSON payload and/or its scope attachments. The
 * config's `createdAt` is intentionally left alone — that's the
 * resolver's tiebreak for same-scope ordering, so promoting an old
 * config to "newest" via an unrelated edit would silently change
 * resolution.
 */
export async function updateConfig(
  ctx: Ctx,
  params: {
    id: string;
    config?: Record<string, unknown>;
    scopes?: ScopeAttachment[];
    authorId?: string | null;
  },
): Promise<void> {
  const data: { config?: Record<string, string>; authorId?: string | null } = {};
  if (params.config !== undefined) {
    const clean = sanitizeConfig(params.config);
    if (Object.keys(clean).length === 0) {
      // Empty config = pure inherit at every key. We treat that as a
      // delete because an attached-but-empty config has no effect on
      // resolution but still occupies the same-scope tiebreak slot
      // (newest empty would mask older non-empty at the same scope).
      await deleteConfig(ctx, params.id);
      return;
    }
    data.config = clean;
  }
  if (params.authorId !== undefined) data.authorId = params.authorId;

  if (params.scopes !== undefined) {
    // Replace-all semantics for scope attachments: empty array → delete
    // the config (an unattached config can never be hit by the
    // resolver). Otherwise compute the add/remove diff against the
    // current set.
    if (params.scopes.length === 0) {
      await deleteConfig(ctx, params.id);
      return;
    }
    const desired = new Map<string, ScopeAttachment>();
    for (const s of params.scopes) {
      desired.set(`${s.scopeType}::${s.scopeId}`, s);
    }
    const current = await ctx.prisma.modelDefaultConfigScope.findMany({
      where: { configId: params.id },
      select: { id: true, scopeType: true, scopeId: true },
    });
    const currentByKey = new Map(
      current.map((c) => [`${c.scopeType}::${c.scopeId}`, c]),
    );
    const toAdd = [...desired.values()].filter(
      (s) => !currentByKey.has(`${s.scopeType}::${s.scopeId}`),
    );
    const toRemove = current.filter(
      (c) => !desired.has(`${c.scopeType}::${c.scopeId}`),
    );

    // Scope mutation needs the multi-statement batch form of
    // `$transaction`, which only the root Prisma client exposes —
    // transaction clients themselves do not. Fail loudly if some
    // future caller passes a tx client into this branch rather than
    // hiding the crash behind a runtime cast.
    if (!("$transaction" in ctx.prisma)) {
      throw new Error(
        "modelDefaults.updateConfig: scope updates must be called with a root PrismaClient, not a transaction client.",
      );
    }
    const prisma = ctx.prisma as PrismaClient;
    await prisma.$transaction([
      prisma.modelDefaultConfig.update({
        where: { id: params.id },
        data,
      }),
      ...(toAdd.length > 0
        ? [
            prisma.modelDefaultConfigScope.createMany({
              data: toAdd.map((s) => ({
                configId: params.id,
                scopeType: s.scopeType,
                scopeId: s.scopeId,
              })),
            }),
          ]
        : []),
      ...(toRemove.length > 0
        ? [
            prisma.modelDefaultConfigScope.deleteMany({
              where: { id: { in: toRemove.map((c) => c.id) } },
            }),
          ]
        : []),
    ]);
    return;
  }

  // No scope changes — just bump the JSON / authorId.
  await ctx.prisma.modelDefaultConfig.update({
    where: { id: params.id },
    data,
  });
}

/**
 * Delete a config. Scope attachments cascade via the FK.
 */
export async function deleteConfig(
  ctx: Ctx,
  configId: string,
): Promise<void> {
  await ctx.prisma.modelDefaultConfig.delete({ where: { id: configId } });
}

/**
 * Convenience helper used by the create-provider seed + the
 * "set as default" flow on the provider form. Sets one role's value
 * inside the (only) config attached at the given scope, creating that
 * config if none exists. The caller is responsible for scope-level
 * RBAC; this function does not check permissions.
 */
export async function setRoleAtScope(
  ctx: Ctx,
  params: {
    scopeType: ModelDefaultScopeType;
    scopeId: string;
    role: ModelRole;
    model: string | null;
    authorId?: string | null;
  },
): Promise<void> {
  const valid = validKeySet();
  if (!valid.has(params.role)) {
    throw new Error(`Unknown role: "${params.role}".`);
  }
  await upsertKeyAtScope(ctx, {
    scopeType: params.scopeType,
    scopeId: params.scopeId,
    key: params.role,
    model: params.model,
    authorId: params.authorId,
  });
}

/**
 * Same as setRoleAtScope but for a feature key (registry-validated).
 * Used by the per-feature override row in the drawer.
 */
export async function setFeatureAtScope(
  ctx: Ctx,
  params: {
    scopeType: ModelDefaultScopeType;
    scopeId: string;
    featureKey: string;
    model: string | null;
    authorId?: string | null;
  },
): Promise<void> {
  if (!featureByKey(params.featureKey)) {
    throw new Error(`Unknown feature key: "${params.featureKey}".`);
  }
  await upsertKeyAtScope(ctx, {
    scopeType: params.scopeType,
    scopeId: params.scopeId,
    key: params.featureKey,
    model: params.model,
    authorId: params.authorId,
  });
}

/**
 * Shared upsert path for setRoleAtScope + setFeatureAtScope. Runs
 * inside a `$transaction` so the advisory lock is released exactly
 * when the write commits / rolls back, and so concurrent callers at
 * the same scope serialise without contending across scopes.
 *
 *  1. Acquire the per-scope advisory lock (release on tx end).
 *  2. Look for an existing config attached to the scope. If multiple,
 *     pick the newest (matches the resolver's same-scope tiebreak
 *     so the user's edit affects the row they actually see).
 *  3. If model is null, remove the key from the existing config (or
 *     no-op if no config carries it).
 *  4. Otherwise merge the key into the existing config or create a
 *     fresh one with just this key.
 */
async function upsertKeyAtScope(
  ctx: Ctx,
  params: {
    scopeType: ModelDefaultScopeType;
    scopeId: string;
    key: string;
    model: string | null;
    authorId?: string | null;
  },
): Promise<void> {
  await (ctx.prisma as PrismaClient).$transaction(async (tx) => {
    await lockScope(tx, params.scopeType, params.scopeId);

    const attached = await tx.modelDefaultConfigScope.findMany({
      where: { scopeType: params.scopeType, scopeId: params.scopeId },
      select: {
        config: { select: { id: true, config: true, createdAt: true } },
      },
    });
    attached.sort(
      (a, b) =>
        (b.config.createdAt?.getTime() ?? 0) -
        (a.config.createdAt?.getTime() ?? 0),
    );
    const target = attached[0]?.config;

    if (params.model === null) {
      if (!target) return;
      const next = { ...((target.config ?? {}) as Record<string, unknown>) };
      delete next[params.key];
      await updateConfig({ prisma: tx }, {
        id: target.id,
        config: next,
        authorId: params.authorId,
      });
      return;
    }

    if (target) {
      const next = {
        ...((target.config ?? {}) as Record<string, unknown>),
        [params.key]: params.model,
      };
      await updateConfig({ prisma: tx }, {
        id: target.id,
        config: next,
        authorId: params.authorId,
      });
      return;
    }

    await createConfig({ prisma: tx }, {
      config: { [params.key]: params.model },
      scopes: [{ scopeType: params.scopeType, scopeId: params.scopeId }],
      authorId: params.authorId ?? null,
    });
  });
}
