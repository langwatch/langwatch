import type { PrismaClient } from "@prisma/client";

import type { ModelRole } from "./featureRegistry";
import { featureByKey } from "./featureRegistry";

interface Ctx {
  prisma: PrismaClient;
}

export type ScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";

/**
 * Sets (or clears) the role-level default model at a scope. Writes to
 * `ModelDefault` only — never the legacy B2 scalar columns on
 * Organization / Team / Project, so the legacy fields drain to read-only
 * over time and the resolver always sees the freshest source of truth.
 *
 * Passing `model === null` clears the row (used when the UI removes a
 * scope override line).
 */
export async function setRoleAssignment(
  ctx: Ctx,
  params: {
    scopeType: ScopeType;
    scopeId: string;
    role: ModelRole;
    model: string | null;
    authorId?: string | null;
  },
): Promise<void> {
  const { scopeType, scopeId, role, model, authorId } = params;
  if (model === null) {
    await ctx.prisma.modelDefault.deleteMany({
      where: { scopeType, scopeId, role, featureKey: null },
    });
    return;
  }
  const existing = await ctx.prisma.modelDefault.findFirst({
    where: { scopeType, scopeId, role, featureKey: null },
  });
  if (existing) {
    await ctx.prisma.modelDefault.update({
      where: { id: existing.id },
      data: { model, authorId: authorId ?? null },
    });
    return;
  }
  await ctx.prisma.modelDefault.create({
    data: {
      scopeType,
      scopeId,
      role,
      featureKey: null,
      model,
      authorId: authorId ?? null,
    },
  });
}

/**
 * Sets (or clears) a per-feature override at a scope. The feature must
 * exist in the registry; its role determines which `ModelDefault.role`
 * the row carries.
 */
export async function setFeatureOverride(
  ctx: Ctx,
  params: {
    scopeType: ScopeType;
    scopeId: string;
    featureKey: string;
    model: string | null;
    authorId?: string | null;
  },
): Promise<void> {
  const { scopeType, scopeId, featureKey, model, authorId } = params;
  const feature = featureByKey(featureKey);
  if (!feature) {
    throw new Error(`Unknown feature key: "${featureKey}".`);
  }
  if (model === null) {
    await ctx.prisma.modelDefault.deleteMany({
      where: { scopeType, scopeId, role: feature.role, featureKey },
    });
    return;
  }
  const existing = await ctx.prisma.modelDefault.findFirst({
    where: { scopeType, scopeId, role: feature.role, featureKey },
  });
  if (existing) {
    await ctx.prisma.modelDefault.update({
      where: { id: existing.id },
      data: { model, authorId: authorId ?? null },
    });
    return;
  }
  await ctx.prisma.modelDefault.create({
    data: {
      scopeType,
      scopeId,
      role: feature.role,
      featureKey,
      model,
      authorId: authorId ?? null,
    },
  });
}
