/**
 * Direct probe of the new gateway-config bundle shape against the seeded
 * dogfood org. Bypasses the Go gateway + HMAC-signed gateway-internal
 * routes — calls the materialiser directly so we can validate the wire
 * shape (project_id / project_otlp_token nullability, scope cascade,
 * provider ordering) without a running gateway / control plane.
 *
 * Run after `pnpm tsx scripts/seed-governance-refactor-dogfood.ts`.
 */
import { prisma } from "~/server/db";
import { GatewayConfigMaterialiser } from "~/server/gateway/config.materialiser";
import {
  eligibleModelProvidersForVk,
  resolveTraceProject,
} from "~/server/gateway/scopeResolver";
import { hashVirtualKeySecret } from "~/server/gateway/virtualKey.crypto";

const VK_SECRETS = process.env.VK_SECRETS?.split(",") ?? [];

async function probe(secret: string) {
  const hashed = hashVirtualKeySecret(secret);
  const vk = await prisma.virtualKey.findFirst({
    where: { hashedSecret: hashed },
    include: { scopes: true },
  });
  if (!vk) {
    console.log(`✗ ${secret.slice(0, 18)}… → unknown VK`);
    return;
  }

  const eligibleMPs = await eligibleModelProvidersForVk(prisma, vk);
  const traceProject = await resolveTraceProject(prisma, vk);

  const materialiser = new GatewayConfigMaterialiser(prisma, null);
  const bundle = await materialiser.materialise(vk);

  console.log(`\n=== ${vk.name} (${vk.id}) ===`);
  console.log(`  scopes:           ${vk.scopes.map((s) => `${s.scopeType}:${s.scopeId.slice(0, 10)}…`).join(", ") || "(none)"}`);
  console.log(`  organizationId:   ${vk.organizationId}`);
  console.log(`  routingPolicyId:  ${vk.routingPolicyId ?? "(none, falls back to deterministic order)"}`);
  console.log(`  principalUserId:  ${vk.principalUserId ?? "(null)"}`);
  console.log(`  → eligible MPs:     ${eligibleMPs.map((m) => `${m.provider}(${m.id.slice(0, 8)}…)`).join(", ") || "(empty)"}`);
  console.log(`  → traceProject:     ${traceProject ? `${traceProject.id} (apiKey=${traceProject.apiKey.slice(0, 12)}…)` : "null (no project_id on bundle)"}`);
  console.log(`  → bundle.project_id:        ${bundle.project_id ?? "null"}`);
  console.log(`  → bundle.team_id:           ${bundle.team_id ?? "null"}`);
  console.log(`  → bundle.providers[].type:  [${bundle.providers.map((p) => p.type).join(", ")}]`);
  console.log(`  → bundle.fallback.chain:    [${bundle.fallback.chain.map((id) => id.slice(0, 8) + "…").join(", ")}]`);
  console.log(`  → bundle.budgets.count:     ${bundle.budgets.length}`);
  console.log(`  → bundle.cache_rules.count: ${bundle.cache_rules.length}`);
}

async function main() {
  if (VK_SECRETS.length === 0) {
    console.error(
      "Usage: VK_SECRETS=vk-lw-...,vk-lw-... pnpm tsx scripts/_dogfood_probe_bundle.ts",
    );
    process.exit(2);
  }
  for (const secret of VK_SECRETS) {
    try {
      await probe(secret.trim());
    } catch (err) {
      console.error(`✗ probe failed for ${secret.slice(0, 18)}…`, err);
    }
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
