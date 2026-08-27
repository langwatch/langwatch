/**
 * Re-runs the /api/internal/gateway/resolve-key handler logic in
 * isolation against a seeded VK secret. Surfaces the actual throw site
 * the Hono CP swallows behind 500-Internal-Server-Error.
 */
import { prisma } from "~/server/db";
import { initializeDefaultApp } from "~/server/app-layer/presets";
import { signGatewayJwt } from "~/server/gateway/gatewayJwt";
import { hashVirtualKeySecret } from "@langwatch/gateway-server";

async function main() {
  const presented = process.env.VK_SECRET;
  if (!presented) {
    console.error(
      "Usage: VK_SECRET=vk-lw-... pnpm tsx scripts/_dogfood_probe_resolvekey.ts",
    );
    process.exit(2);
  }

  const hashed = hashVirtualKeySecret(presented);
  console.log("hashed length:", hashed.length);

  const app = initializeDefaultApp({ processRole: "web" });
  const service = app.gateway.virtualKeys;
  const vk = await service.getByHashedSecretInternal(hashed);
  console.log("vk:", vk ? `${vk.id} (${vk.name})` : "null");
  if (!vk) return;

  const traceProject = vk.traceProjectId
    ? await app.projects.tryGetTraceDestination(vk.traceProjectId)
    : null;
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
