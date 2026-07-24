/**
 * R3 backfill walk for the bug 7 refactor.
 *
 * For every VirtualKey whose `vk.config` still carries non-empty
 * legacy keys (modelAliases / policyRules / guardrails), mint the
 * downstream rows that took over those responsibilities, then strip
 * the legacy keys from `vk.config`:
 *
 *   - non-empty `modelAliases` or `policyRules` => mint one
 *     RoutingPolicy at the SAME scope set as the source VK
 *     (cloning every VirtualKeyScope row to a matching
 *     RoutingPolicyScope row), name pattern
 *     `<vkname>-migrated-aliases-YYYYMMDD`, set
 *     `vk.routingPolicyId` to the new policy.
 *
 *   - non-empty `guardrails` => mint one GatewayGuardrail row per
 *     (direction, evaluator) tuple in the VK's project (each row
 *     references the evaluator + direction; failureMode derived
 *     from the matching legacy `requestFailOpen` / `responseFailOpen`
 *     flag), then write
 *     `vk.config.guardrailAttachments` with `{direction, guardrailIds[]}`
 *     entries pointing at the new rows.
 *
 *   - all three keys then stripped from `vk.config`.
 *
 * The companion migration 20260524163000_strip_vk_config_legacy_keys
 * RAISEs on any leftover non-empty content. Run this script first,
 * then re-run `prisma migrate deploy`.
 *
 * Idempotent: safe to re-run. Already-migrated VKs (config has none
 * of the 3 keys, or routingPolicyId already set + 0 attachments)
 * are skipped.
 *
 * Usage:
 *   pnpm tsx scripts/migrations/backfill-vk-config-to-rp.ts
 *   DRY_RUN=1 pnpm tsx scripts/migrations/backfill-vk-config-to-rp.ts
 *
 * Spec: specs/ai-gateway/governance/routing-policy-scope-cascade.feature L72-87
 *       specs/ai-gateway/governance/guardrails-project-scope.feature L34-42
 */
import { nanoid } from "nanoid";

import { prisma } from "~/server/db";

const DRY_RUN = process.env.DRY_RUN === "1";

type LegacyPolicyRuleDim = {
  deny?: string[];
  allow?: string[] | null;
};

type LegacyGuardrailRef = { id: string; evaluator: string };

type LegacyConfig = {
  modelAliases?: Record<string, string>;
  policyRules?: {
    tools?: LegacyPolicyRuleDim;
    mcp?: LegacyPolicyRuleDim;
    urls?: LegacyPolicyRuleDim;
    models?: LegacyPolicyRuleDim;
  };
  guardrails?: {
    pre?: LegacyGuardrailRef[];
    post?: LegacyGuardrailRef[];
    streamChunk?: LegacyGuardrailRef[];
    requestFailOpen?: boolean;
    responseFailOpen?: boolean;
  };
  // Anything else stays untouched.
  [k: string]: unknown;
};

function isNonEmptyAliases(c: LegacyConfig): boolean {
  return !!c.modelAliases && Object.keys(c.modelAliases).length > 0;
}

function isNonEmptyPolicyRules(c: LegacyConfig): boolean {
  const dims = c.policyRules;
  if (!dims) return false;
  for (const key of ["tools", "mcp", "urls", "models"] as const) {
    const d = dims[key];
    if (!d) continue;
    if ((d.deny ?? []).length > 0) return true;
    if (d.allow && d.allow.length > 0) return true;
  }
  return false;
}

function isNonEmptyGuardrails(c: LegacyConfig): boolean {
  const g = c.guardrails;
  if (!g) return false;
  return (
    (g.pre?.length ?? 0) > 0 ||
    (g.post?.length ?? 0) > 0 ||
    (g.streamChunk?.length ?? 0) > 0
  );
}

function todayYYYYMMDD(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function backfillAliasesAndRules(
  vkId: string,
  vkName: string,
  orgId: string,
  scopes: Array<{ scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }>,
  modelAliases: Record<string, string> | undefined,
  policyRules: LegacyConfig["policyRules"],
): Promise<string> {
  const rpId = `rp_migr_${nanoid()}`;
  const rpName = `${vkName}-migrated-aliases-${todayYYYYMMDD()}`;
  const primary = scopes[0]!;

  if (DRY_RUN) {
    console.log(`[dry-run] mint RP ${rpId} (${rpName}) scopes=${scopes.length}`);
    return rpId;
  }

  await prisma.routingPolicy.create({
    data: {
      id: rpId,
      organizationId: orgId,
      name: rpName,
      description: `Auto-migrated from VirtualKey ${vkId} (${vkName}) on R3 backfill.`,
      modelProviderIds: [],
      strategy: "priority",
      // Legacy single-scope columns mirror the primary scope; the
      // join table below is the new source of truth.
      scope: primary.scopeType,
      scopeId: primary.scopeId,
      modelAliases: modelAliases ?? {},
      policyRules: policyRules ?? {},
      scopes: {
        create: scopes.map((s) => ({
          scopeType: s.scopeType,
          scopeId: s.scopeId,
        })),
      },
    },
  });

  return rpId;
}

type GuardrailAttachment = { direction: "pre" | "post" | "streamChunk"; guardrailIds: string[] };

async function backfillGuardrails(
  vkId: string,
  vkScopes: Array<{ scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }>,
  legacy: NonNullable<LegacyConfig["guardrails"]>,
): Promise<GuardrailAttachment[]> {
  // GatewayGuardrail is project-scoped only. Pick the first PROJECT
  // scope on the VK; if none, skip with a warning (this matches the
  // spec invariant that guardrails are project-level only — VKs at
  // strict TEAM/ORG scope have no project anchor to attach to).
  const projectScope = vkScopes.find((s) => s.scopeType === "PROJECT");
  if (!projectScope) {
    console.warn(
      `vk=${vkId} has guardrails but no PROJECT scope — cannot lift to GatewayGuardrail (project-scoped only). Skipping.`,
    );
    return [];
  }

  const attachments: GuardrailAttachment[] = [];
  for (const direction of ["pre", "post", "streamChunk"] as const) {
    const refs = legacy[direction] ?? [];
    if (refs.length === 0) continue;
    const ids: string[] = [];
    for (const ref of refs) {
      const failOpen =
        (direction === "pre" && !!legacy.requestFailOpen) ||
        ((direction === "post" || direction === "streamChunk") &&
          !!legacy.responseFailOpen);
      if (DRY_RUN) {
        console.log(
          `[dry-run] mint GatewayGuardrail vk=${vkId} project=${projectScope.scopeId} dir=${direction} evaluator=${ref.id}`,
        );
        ids.push(`gr_dryrun_${ref.id}`);
        continue;
      }
      const created = await prisma.gatewayGuardrail.create({
        data: {
          projectId: projectScope.scopeId,
          name: `${ref.evaluator}-${direction}`,
          evaluatorId: ref.id,
          direction:
            direction === "streamChunk"
              ? "STREAM_CHUNK"
              : (direction.toUpperCase() as "PRE" | "POST"),
          failureMode: failOpen ? "FAIL_OPEN" : "FAIL_CLOSED",
        },
      });
      ids.push(created.id);
    }
    attachments.push({ direction, guardrailIds: ids });
  }
  return attachments;
}

async function main() {
  console.log(`R3 backfill walk start ${DRY_RUN ? "[DRY-RUN]" : ""}`);
  // dbMultiTenancyProtection requires a scope/tenant predicate on
  // VK queries. Iterate per-org so each call is bounded by
  // organizationId.
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const vks = (
    await Promise.all(
      orgs.map((o) =>
        prisma.virtualKey.findMany({
          where: { organizationId: o.id },
          include: { scopes: true },
          orderBy: { createdAt: "asc" },
        }),
      ),
    )
  ).flat();
  let touched = 0;
  for (const vk of vks) {
    const config = (vk.config ?? {}) as LegacyConfig;
    const hasAliases = isNonEmptyAliases(config);
    const hasRules = isNonEmptyPolicyRules(config);
    const hasGuardrails = isNonEmptyGuardrails(config);
    if (!hasAliases && !hasRules && !hasGuardrails) continue;

    console.log(
      `vk=${vk.id} (${vk.name}) backfill: aliases=${hasAliases} rules=${hasRules} guardrails=${hasGuardrails}`,
    );

    const scopes = vk.scopes.map((s) => ({
      scopeType: s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
      scopeId: s.scopeId,
    }));

    let routingPolicyId: string | null = vk.routingPolicyId;
    if ((hasAliases || hasRules) && !routingPolicyId) {
      routingPolicyId = await backfillAliasesAndRules(
        vk.id,
        vk.name,
        vk.organizationId,
        scopes,
        config.modelAliases,
        config.policyRules,
      );
    }

    let attachments: GuardrailAttachment[] = [];
    if (hasGuardrails && config.guardrails) {
      attachments = await backfillGuardrails(vk.id, scopes, config.guardrails);
    }

    // Strip the 3 legacy keys + add guardrailAttachments[] if any.
    const next: Record<string, unknown> = { ...(config as object) };
    delete next.modelAliases;
    delete next.policyRules;
    delete next.guardrails;
    if (attachments.length > 0) {
      next.guardrailAttachments = attachments;
    }

    if (DRY_RUN) {
      console.log(`[dry-run] update vk=${vk.id} routingPolicyId=${routingPolicyId}`);
    } else {
      await prisma.virtualKey.update({
        where: { id: vk.id },
        data: {
          config: next as never,
          routingPolicyId,
        },
      });
    }
    touched++;
  }
  console.log(`R3 backfill walk done — touched ${touched} / ${vks.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
