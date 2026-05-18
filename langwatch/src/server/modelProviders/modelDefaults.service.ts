import type { ModelDefaultScopeType, PrismaClient } from "@prisma/client";

import type { Session } from "~/server/auth";
import {
  hasOrganizationPermission,
  hasProjectPermission,
  hasTeamPermission,
} from "../api/rbac";
import {
  allFeatures,
  featureByKey,
  MODEL_ROLES,
  type ModelRole,
} from "./featureRegistry";
import {
  ModelDefaultsRepository,
  type ModelDefaultsPrisma,
  type ScopeAttachment,
} from "./modelDefaults.repository";

export type { ScopeAttachment };

interface Ctx {
  prisma: ModelDefaultsPrisma;
}

export type AuthCtx = {
  prisma: PrismaClient;
  session: Session | null;
};

function repoFor(ctx: Ctx): ModelDefaultsRepository {
  return new ModelDefaultsRepository(ctx.prisma);
}

/**
 * RBAC guard for the role/feature default writers. Each scope demands
 * a different permission so a project admin can't silently push a role
 * default up to the organization scope. Mirrors the model-providers
 * update mutation's scope-aware authz, and is the single gate both
 * the tRPC router and the Hono /api/model-defaults route call.
 */
export async function assertCanWriteScope(
  ctx: AuthCtx,
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT",
  scopeId: string,
): Promise<void> {
  if (!ctx.session?.user?.id) {
    throw new Error("Not authenticated");
  }
  if (scopeType === "ORGANIZATION") {
    if (
      !(await hasOrganizationPermission(
        ctx as { prisma: PrismaClient; session: Session },
        scopeId,
        "organization:manage",
      ))
    ) {
      throw new Error("Missing organization:manage permission");
    }
    return;
  }
  if (scopeType === "TEAM") {
    if (!(await hasTeamPermission(ctx, scopeId, "team:manage"))) {
      throw new Error("Missing team:manage permission");
    }
    return;
  }
  if (!(await hasProjectPermission(ctx, scopeId, "project:update"))) {
    throw new Error("Missing project:update permission");
  }
}

/**
 * Load the current scope attachments for a config row. Used by the
 * delete + save-config auth gates so callers can verify they're allowed
 * to touch every attachment.
 */
export async function getScopeAttachmentsForConfig(
  ctx: Ctx,
  configId: string,
): Promise<ScopeAttachment[]> {
  const scopes = await ctx.prisma.modelDefaultConfigScope.findMany({
    where: { configId },
    select: { scopeType: true, scopeId: true },
  });
  return scopes.map((s) => ({
    scopeType: s.scopeType,
    scopeId: s.scopeId,
  }));
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

function dedupeScopes(scopes: ScopeAttachment[]): ScopeAttachment[] {
  const seen = new Set<string>();
  const out: ScopeAttachment[] = [];
  for (const s of scopes) {
    const key = `${s.scopeType}::${s.scopeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
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
    throw new Error(
      "ModelDefaultConfig must carry at least one role or feature key.",
    );
  }
  if (params.scopes.length === 0) {
    throw new Error("ModelDefaultConfig must attach to at least one scope.");
  }
  return repoFor(ctx).create({
    config,
    scopes: dedupeScopes(params.scopes),
    authorId: params.authorId ?? null,
  });
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
  const repo = repoFor(ctx);
  const data: { config?: Record<string, string>; authorId?: string | null } = {};
  if (params.config !== undefined) {
    const clean = sanitizeConfig(params.config);
    if (Object.keys(clean).length === 0) {
      // Empty config = pure inherit at every key. We treat that as a
      // delete because an attached-but-empty config has no effect on
      // resolution but still occupies the same-scope tiebreak slot
      // (newest empty would mask older non-empty at the same scope).
      await repo.delete(params.id);
      return;
    }
    data.config = clean;
  }
  if (params.authorId !== undefined) data.authorId = params.authorId;

  if (params.scopes === undefined) {
    // No scope changes — just bump the JSON / authorId.
    await repo.updateConfigPayload({ id: params.id, data });
    return;
  }

  // Replace-all semantics for scope attachments: empty array → delete
  // the config (an unattached config can never be hit by the
  // resolver). Otherwise compute the add/remove diff against the
  // current set.
  if (params.scopes.length === 0) {
    await repo.delete(params.id);
    return;
  }
  const desired = new Map<string, ScopeAttachment>();
  for (const s of params.scopes) {
    desired.set(`${s.scopeType}::${s.scopeId}`, s);
  }
  const current = await repo.findScopesForConfig(params.id);
  const currentByKey = new Map(
    current.map((c) => [`${c.scopeType}::${c.scopeId}`, c]),
  );
  const toAdd = [...desired.values()].filter(
    (s) => !currentByKey.has(`${s.scopeType}::${s.scopeId}`),
  );
  const toRemove = current.filter(
    (c) => !desired.has(`${c.scopeType}::${c.scopeId}`),
  );
  await repo.updateConfigScopes({
    id: params.id,
    configPayload: data,
    toAdd,
    toRemoveIds: toRemove.map((c) => c.id),
  });
}

/**
 * Delete a config. Scope attachments cascade via the FK.
 */
export async function deleteConfig(
  ctx: Ctx,
  configId: string,
): Promise<void> {
  await repoFor(ctx).delete(configId);
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
 *
 * The bug this guards: useProviderFormSubmit fans out 3 concurrent
 * mutations (DEFAULT / FAST / EMBEDDINGS) on the same scope. Without
 * the advisory lock, all three see no existing config and each create
 * a fresh one, leaving 3 separate ModelDefaultConfig rows attached to
 * the same scope.
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
    const txRepo = new ModelDefaultsRepository(tx);
    await txRepo.lockScope(params.scopeType, params.scopeId);

    const attached = await txRepo.findConfigsAtScope(
      params.scopeType,
      params.scopeId,
    );
    const target = attached[0];

    if (params.model === null) {
      if (!target) return;
      const next = { ...((target.config ?? {}) as Record<string, unknown>) };
      delete next[params.key];
      await updateConfig(
        { prisma: tx },
        {
          id: target.id,
          config: next,
          authorId: params.authorId,
        },
      );
      return;
    }

    if (target) {
      const next = {
        ...((target.config ?? {}) as Record<string, unknown>),
        [params.key]: params.model,
      };
      await updateConfig(
        { prisma: tx },
        {
          id: target.id,
          config: next,
          authorId: params.authorId,
        },
      );
      return;
    }

    await createConfig(
      { prisma: tx },
      {
        config: { [params.key]: params.model },
        scopes: [{ scopeType: params.scopeType, scopeId: params.scopeId }],
        authorId: params.authorId ?? null,
      },
    );
  });
}
