/**
 * Re-runs the /api/internal/gateway/resolve-key handler logic in
 * isolation against a seeded VK secret. Surfaces the actual throw site
 * the Hono CP swallows behind 500-Internal-Server-Error.
 */
import { prisma } from "~/server/db";
import { signGatewayJwt } from "~/server/gateway/gatewayJwt";
import { resolveTraceProject } from "~/server/gateway/scopeResolver";
import { hashVirtualKeySecret } from "~/server/gateway/virtualKey.crypto";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";

async function main() {
  const presented = process.env.VK_SECRET;
  if (!presented) {
    console.error("Usage: VK_SECRET=vk-lw-... pnpm tsx scripts/_dogfood_probe_resolvekey.ts");
    process.exit(2);
  }

  const hashed = hashVirtualKeySecret(presented);
  console.log("hashed length:", hashed.length);

  const service = VirtualKeyService.create(prisma);
  const vk = await service.getByHashedSecretInternal(hashed);
  console.log("vk:", vk ? `${vk.id} (${vk.name})` : "null");
  if (!vk) return;

  const traceProject = await resolveTraceProject(prisma, vk);
  console.log("traceProject:", traceProject);

  const { jwt } = signGatewayJwt({
    vk_id: vk.id,
    project_id: traceProject?.id ?? null,
    team_id: traceProject?.teamId ?? null,
    org_id: vk.organizationId,
    principal_id: vk.principalUserId,
    revision: vk.revision.toString(),
  });
  console.log("jwt prefix:", jwt.slice(0, 32) + "...");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("THREW:", err);
  process.exit(1);
});
