import { ValidationError } from "@langwatch/handled-error";
import type {
  ModelDefaultScopeType,
  PrismaClient,
} from "~/generated/prisma/client";

import type { Session } from "~/server/auth";
import {
  hasOrganizationPermission,
  hasProjectPermission,
  hasTeamPermission,
} from "../api/rbac";
import { isRootPrismaClient } from "../db";
import { CODING_ASSISTANT_SURFACES_ONLY_NEEDLE } from "./codexRefusalMessage";
import {
  isModelAllowedAsRoleDefault,
  isModelAllowedForFeature,
} from "./codexRestrictions";
import { ModelDefaultScopeForbiddenError } from "./errors";
import {
  allFeatures,
  featureByKey,
  MODEL_ROLES,
  type ModelRole,
} from "./featureRegistry";
import {
  type ModelDefaultsPrisma,
  ModelDefaultsRepository,
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
      throw new ModelDefaultScopeForbiddenError({
        scopeType,
        requiredPermission: "organization:manage",
      });
    }
    return;
  }
  if (scopeType === "TEAM") {
    if (!(await hasTeamPermission(ctx, scopeId, "team:manage"))) {
      throw new ModelDefaultScopeForbiddenError({
        scopeType,
        requiredPermission: "team:manage",
      });
    }
    return;
  }
  if (!(await hasProjectPermission(ctx, scopeId, "project:update"))) {
    throw new ModelDefaultScopeForbiddenError({
      scopeType,
      requiredPermission: "project:update",
    });
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
  const roleKeys = new Set<string>(MODEL_ROLES);
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!valid.has(key)) continue;
    if (typeof value !== "string") continue;
    if (value.length === 0) continue;
    // Restricted models (codex) are rejected loudly, not dropped: a save
    // that silently loses a key would read as "worked" in the drawer.
    const allowed = roleKeys.has(key)
      ? isModelAllowedAsRoleDefault(value, key as ModelRole)
      : isModelAllowedForFeature({ modelId: value, featureKey: key });
    if (!allowed) {
      throw new ValidationError(
        `"${value}" ${CODING_ASSISTANT_SURFACES_ONLY_NEEDLE} and cannot be set for "${key}".`,
      );
    }
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
 * Transaction budget for every default-models write.
 *
 * These writes queue on an advisory lock, and the wait counts against
 * the interactive-transaction timeout. Prisma's default is 5 seconds,
 * which a write queued behind another one in the same organization can
 * exceed, and it would then fail with P2028: an unknown error on a save
 * that only needed to wait its turn. `timeout` therefore has to cover
 * the lock queue, not just the statements. `maxWait` is the separate
 * budget for getting a connection out of the pool.
 */
const WRITE_TX_BUDGET = { timeout: 20_000, maxWait: 10_000 } as const;

/**
 * Run `fn` inside a transaction when handed the root PrismaClient, or
 * directly when the caller already opened one (e.g. `upsertKeyAtScope`
 * calls back into `createConfig` from inside its own `$transaction`).
 */
async function withScopeTransaction<T>(
  prisma: ModelDefaultsPrisma,
  fn: (tx: ModelDefaultsPrisma) => Promise<T>,
): Promise<T> {
  if (isRootPrismaClient(prisma)) {
    return prisma.$transaction(fn, WRITE_TX_BUDGET);
  }
  return fn(prisma);
}

/** Deterministic lock order so two concurrent multi-scope writes can
 * never deadlock on each other's scope locks. Plain byte comparison,
 * not `localeCompare`: a collation-sensitive order could differ between
 * two processes and put the ordering back at risk. */
function sortForLocking(scopes: ScopeAttachment[]): ScopeAttachment[] {
  const key = (s: ScopeAttachment) => `${s.scopeType}::${s.scopeId}`;
  return [...scopes].sort((a, b) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0,
  );
}

/**
 * Take the locks every default-models write needs, in the one order
 * every path uses: the organization first, then the scopes in a stable
 * order.
 *
 * The organization lock is what makes the order total. A scope lock
 * only covers the scopes being attached, while claiming a scope also
 * detaches (and sometimes deletes) whichever config held it, and that
 * config may hold scopes this write never named. Every config a claim
 * can reach is anchored to the same organization as the claimed scope
 * (ADR-021), so locking the organization first covers all of them and
 * no two writes can take row locks in opposite orders.
 */
async function lockForWrite(
  repo: ModelDefaultsRepository,
  params: { organizationId: string; scopes?: ScopeAttachment[] },
): Promise<void> {
  await repo.lockOrganization(params.organizationId);
  for (const s of sortForLocking(params.scopes ?? [])) {
    await repo.lockScope(s.scopeType, s.scopeId);
  }
}

/**
 * Enforce the one-config-per-scope invariant for a write that attaches
 * `scopes` to the config identified by `exceptConfigId` (or a config
 * about to be created): detach those scopes from whichever configs held
 * them, and delete any config left with zero attachments. Callers hold
 * the locks `lockForWrite` takes, inside a transaction.
 */
async function claimScopes(
  repo: ModelDefaultsRepository,
  scopes: ScopeAttachment[],
  opts: { exceptConfigId?: string } = {},
): Promise<void> {
  const held = await repo.findAttachmentsForScopes(scopes, opts);
  if (held.length === 0) return;
  await repo.deleteAttachments(held.map((h) => h.id));
  await repo.deleteConfigsWithoutScopes(
    Array.from(new Set(held.map((h) => h.configId))),
  );
}

/**
 * Create a new ModelDefaultConfig with its scope attachments. Empty
 * configs (no valid keys) are rejected — a config is meaningless
 * without at least one model assignment. Each attached scope is claimed
 * exclusively: a scope belongs to at most one config, so whichever
 * config held it before loses that attachment (and is deleted when
 * nothing else keeps it alive).
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
    throw new ValidationError(
      "Pick at least one model. A default-models config with every key on inherit has no effect.",
    );
  }
  if (params.scopes.length === 0) {
    throw new ValidationError(
      "Pick at least one scope for this default-models config.",
    );
  }
  const scopes = dedupeScopes(params.scopes);
  return withScopeTransaction(ctx.prisma, async (tx) => {
    const repo = new ModelDefaultsRepository(tx);
    const organizationId = await repo.organizationIdForScopes(scopes);
    await lockForWrite(repo, { organizationId, scopes });
    await claimScopes(repo, scopes);
    return repo.create({
      config,
      scopes,
      authorId: params.authorId ?? null,
    });
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
  const data: { config?: Record<string, string>; authorId?: string | null } =
    {};
  let deletesTheConfig = false;
  if (params.config !== undefined) {
    const clean = sanitizeConfig(params.config);
    if (Object.keys(clean).length === 0) {
      // Empty config = pure inherit at every key. We treat that as a
      // delete because an attached-but-empty config has no effect on
      // resolution but still occupies the same-scope tiebreak slot
      // (newest empty would mask older non-empty at the same scope).
      deletesTheConfig = true;
    }
    data.config = clean;
  }
  if (params.authorId !== undefined) data.authorId = params.authorId;

  // Replace-all semantics for scope attachments: empty array → delete
  // the config (an unattached config can never be hit by the
  // resolver). Otherwise compute the add/remove diff against the
  // current set. Newly added scopes are claimed exclusively: whichever
  // config held them before loses the attachment, same invariant as
  // `createConfig`.
  if (params.scopes !== undefined && params.scopes.length === 0) {
    deletesTheConfig = true;
  }

  // Every branch runs under the config's organization lock, deletes
  // included: a delete that skipped it could race a concurrent claim
  // for the same config and fail on a row that claim had just
  // collected.
  if (deletesTheConfig || params.scopes === undefined) {
    await withScopeTransaction(ctx.prisma, async (tx) => {
      const txRepo = new ModelDefaultsRepository(tx);
      const organizationId = await txRepo.findOrganizationIdForConfig(
        params.id,
      );
      // Already gone: a concurrent save claimed its last scope and
      // collected it. Both branches below are satisfied by that.
      if (!organizationId) return;
      await lockForWrite(txRepo, { organizationId });
      if (deletesTheConfig) {
        await txRepo.delete(params.id);
        return;
      }
      // No scope changes — just bump the JSON / authorId.
      await txRepo.updateConfigPayload({ id: params.id, data });
    });
    return;
  }

  const desiredScopes = dedupeScopes(params.scopes);
  await withScopeTransaction(ctx.prisma, async (tx) => {
    const txRepo = new ModelDefaultsRepository(tx);
    // Resolved from the desired scopes rather than the config row: it
    // is the same organization either way (ADR-021 keeps a config and
    // its scopes in one org), and this way the lock is taken before the
    // config is read instead of after.
    const organizationId = await txRepo.organizationIdForScopes(desiredScopes);
    await lockForWrite(txRepo, { organizationId, scopes: desiredScopes });
    // Gone while we waited for the lock: a concurrent save claimed its
    // last scope and collected it, and that save's config now owns the
    // scopes this one wanted. Re-creating the row here would undo it.
    if ((await txRepo.findOrganizationIdForConfig(params.id)) === null) return;
    const desired = new Map<string, ScopeAttachment>();
    for (const s of desiredScopes) {
      desired.set(`${s.scopeType}::${s.scopeId}`, s);
    }
    const current = await txRepo.findScopesForConfig(params.id);
    const currentByKey = new Map(
      current.map((c) => [`${c.scopeType}::${c.scopeId}`, c]),
    );
    const toAdd = [...desired.values()].filter(
      (s) => !currentByKey.has(`${s.scopeType}::${s.scopeId}`),
    );
    const toRemove = current.filter(
      (c) => !desired.has(`${c.scopeType}::${c.scopeId}`),
    );
    await claimScopes(txRepo, toAdd, { exceptConfigId: params.id });
    await txRepo.updateConfigScopes({
      id: params.id,
      configPayload: data,
      toAdd,
      toRemoveIds: toRemove.map((c) => c.id),
    });
  });
}

/**
 * Delete a config. Scope attachments cascade via the FK. Runs under the
 * organization lock so it orders against a concurrent claim for the
 * same config rather than racing it.
 */
export async function deleteConfig(ctx: Ctx, configId: string): Promise<void> {
  await withScopeTransaction(ctx.prisma, async (tx) => {
    const repo = new ModelDefaultsRepository(tx);
    const organizationId = await repo.findOrganizationIdForConfig(configId);
    // Already gone: a concurrent save claimed its last scope and
    // collected it, which is the outcome this call asked for.
    if (!organizationId) return;
    await lockForWrite(repo, { organizationId });
    await repo.delete(configId);
  });
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
  if (
    params.model !== null &&
    !isModelAllowedAsRoleDefault(params.model, params.role)
  ) {
    throw new Error(
      `"${params.model}" ${CODING_ASSISTANT_SURFACES_ONLY_NEEDLE} and cannot be a ${params.role} role default.`,
    );
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
  if (
    params.model !== null &&
    !isModelAllowedForFeature({
      modelId: params.model,
      featureKey: params.featureKey,
    })
  ) {
    throw new Error(
      `"${params.model}" ${CODING_ASSISTANT_SURFACES_ONLY_NEEDLE} and cannot be the model for "${params.featureKey}".`,
    );
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
    const scope = {
      scopeType: params.scopeType,
      scopeId: params.scopeId,
    };
    // Same organization-then-scope order every other write path uses.
    // Taking only the scope lock here would let this path hold a scope
    // lock while a claiming write held the organization lock and wanted
    // that scope, which is a cycle.
    await lockForWrite(txRepo, {
      organizationId: await txRepo.organizationIdForScopes([scope]),
      scopes: [scope],
    });

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
  }, WRITE_TX_BUDGET);
}
