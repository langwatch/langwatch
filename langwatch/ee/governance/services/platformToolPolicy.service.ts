// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * PlatformToolPolicyService: per-(organization, tool) override for which
 * `langwatch <tool>` paths the CLI may use:
 *
 *   - allowVk: route through the gateway via the user's personal virtual key
 *     (Path A).
 *   - allowOtelDirect: route via direct OTLP to the personal ingestion endpoint
 *     (Path B).
 *
 * A missing row resolves to the hardcoded defaults below, so the policy is
 * purely additive: disabling a path is an explicit admin choice and a fresh org
 * behaves exactly as before this table existed. The CLI mirror of these
 * defaults lives at typescript-sdk/src/cli/utils/governance/platform-tool-policy.ts
 * for the offline / legacy fallback; the two tables must stay in sync.
 *
 * Reads gate on `governance:view`, writes on `governance:manage` (org admin).
 * Every update emits an audit-log row carrying the before/after toggle values.
 *
 * Spec: specs/ai-gateway/governance/cli-tool-mode-policy.feature
 */
import type { PrismaClient } from "@prisma/client";

import { GovernanceAuditRepository } from "../repositories/governanceAudit.repository";

export const PLATFORM_TOOL_SLUGS = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "cursor",
] as const;

export type PlatformToolSlug = (typeof PLATFORM_TOOL_SLUGS)[number];

export interface PlatformToolPolicy {
  allowVk: boolean;
  allowOtelDirect: boolean;
}

/**
 * Hardcoded defaults. claude/codex/gemini/opencode allow both paths; cursor is
 * GUI-only so Path B (a terminal OTLP env) never reaches the agent panel, so it
 * allows the gateway path only.
 */
export const PLATFORM_TOOL_POLICY_DEFAULTS: Record<
  PlatformToolSlug,
  PlatformToolPolicy
> = {
  claude: { allowVk: true, allowOtelDirect: true },
  codex: { allowVk: true, allowOtelDirect: true },
  gemini: { allowVk: true, allowOtelDirect: true },
  opencode: { allowVk: true, allowOtelDirect: true },
  cursor: { allowVk: true, allowOtelDirect: false },
};

export function isPlatformToolSlug(slug: string): slug is PlatformToolSlug {
  return (PLATFORM_TOOL_SLUGS as readonly string[]).includes(slug);
}

export class UnknownPlatformToolError extends Error {
  readonly code = "unknown_platform_tool" as const;
  constructor(slug: string) {
    super(
      `Unknown tool "${slug}". Expected one of: ${PLATFORM_TOOL_SLUGS.join(", ")}`,
    );
    this.name = "UnknownPlatformToolError";
  }
}

export type PlatformToolPolicyMap = Record<PlatformToolSlug, PlatformToolPolicy>;

export class PlatformToolPolicyService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditRepo: GovernanceAuditRepository = new GovernanceAuditRepository(),
  ) {}

  static create(prisma: PrismaClient): PlatformToolPolicyService {
    return new PlatformToolPolicyService(prisma);
  }

  /**
   * The resolved policy map for every known tool: stored rows override the
   * hardcoded defaults, tools with no row keep the default. Consumed by the
   * admin UI (tRPC list) and the CLI bootstrap payload.
   */
  async getForOrg({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<PlatformToolPolicyMap> {
    const rows = await this.prisma.platformToolPolicy.findMany({
      where: { organizationId },
      select: { toolSlug: true, allowVk: true, allowOtelDirect: true },
    });
    const bySlug = new Map(rows.map((r) => [r.toolSlug, r]));

    const map = {} as PlatformToolPolicyMap;
    for (const slug of PLATFORM_TOOL_SLUGS) {
      const row = bySlug.get(slug);
      map[slug] = row
        ? { allowVk: row.allowVk, allowOtelDirect: row.allowOtelDirect }
        : { ...PLATFORM_TOOL_POLICY_DEFAULTS[slug] };
    }
    return map;
  }

  /**
   * Upsert the override for one tool. Partial toggles are merged over the
   * tool's currently-effective policy (stored row or default), so toggling
   * one path never resets the other. Race-safe via the
   * (organizationId, toolSlug) unique. Emits an audit row with before/after.
   */
  async update({
    organizationId,
    toolSlug,
    allowVk,
    allowOtelDirect,
    callerUserId,
  }: {
    organizationId: string;
    toolSlug: string;
    allowVk?: boolean;
    allowOtelDirect?: boolean;
    callerUserId: string;
  }): Promise<PlatformToolPolicy> {
    if (!isPlatformToolSlug(toolSlug)) {
      throw new UnknownPlatformToolError(toolSlug);
    }

    return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.platformToolPolicy.findUnique({
        where: { organizationId_toolSlug: { organizationId, toolSlug } },
        select: { allowVk: true, allowOtelDirect: true },
      });
      const before: PlatformToolPolicy = existing
        ? { allowVk: existing.allowVk, allowOtelDirect: existing.allowOtelDirect }
        : { ...PLATFORM_TOOL_POLICY_DEFAULTS[toolSlug] };

      const after: PlatformToolPolicy = {
        allowVk: allowVk ?? before.allowVk,
        allowOtelDirect: allowOtelDirect ?? before.allowOtelDirect,
      };

      const upserted = await tx.platformToolPolicy.upsert({
        where: { organizationId_toolSlug: { organizationId, toolSlug } },
        create: {
          organizationId,
          toolSlug,
          allowVk: after.allowVk,
          allowOtelDirect: after.allowOtelDirect,
        },
        update: {
          allowVk: after.allowVk,
          allowOtelDirect: after.allowOtelDirect,
        },
        select: { id: true, allowVk: true, allowOtelDirect: true },
      });

      await this.auditRepo.emit(tx, {
        userId: callerUserId,
        organizationId,
        action: "gateway.platform_tool_policy.updated",
        targetKind: "platform_tool_policy",
        targetId: upserted.id,
        before: { allowVk: before.allowVk, allowOtelDirect: before.allowOtelDirect },
        after: { allowVk: after.allowVk, allowOtelDirect: after.allowOtelDirect },
        metadata: { toolSlug },
      });

      return { allowVk: upserted.allowVk, allowOtelDirect: upserted.allowOtelDirect };
    });
  }
}
