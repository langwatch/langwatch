/**
 * Configure ModelProvider + default RoutingPolicy for the test org so
 * the device-flow approve path can issue a Personal VK (storyboard
 * Screen 4 prereq). Idempotent.
 */
import { prisma } from "~/server/db";

async function main(): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { email: "alexis-dogfood@acme.invalid" },
    include: {
      orgMemberships: {
        include: {
          organization: { include: { teams: { include: { projects: true } } } },
        },
      },
    },
  });
  if (!user) throw new Error("user alexis-dogfood@acme.invalid not found");
  const org = user.orgMemberships[0]?.organization;
  if (!org) throw new Error("no org membership");
  console.log(`[setup] org=${org.id} (${org.slug})`);

  const project = org.teams[0]?.projects.find((p) => p.kind === "application");
  if (!project) throw new Error("no application project");

  // 1. ModelProvider (org-scoped via ModelProviderScope) — idempotent.
  const existingScope = await prisma.modelProviderScope.findFirst({
    where: { scopeType: "ORGANIZATION", scopeId: org.id },
    include: { modelProvider: true },
  });
  let providerId: string;
  if (existingScope) {
    providerId = existingScope.modelProviderId;
    console.log(`[setup] ModelProvider exists: ${existingScope.modelProvider.provider} (id=${providerId})`);
  } else {
    const created = await prisma.modelProvider.create({
      data: {
        projectId: project.id,
        name: "OpenAI",
        provider: "openai",
        enabled: true,
        customKeys: {},
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: org.id }] },
      },
    });
    providerId = created.id;
    console.log(`[setup] created ModelProvider id=${providerId} provider=openai org-scoped`);
  }

  // 2. Default RoutingPolicy — idempotent.
  const existingPolicy = await prisma.routingPolicy.findFirst({
    where: { organizationId: org.id, isDefault: true },
  });
  if (existingPolicy) {
    console.log(`[setup] default RoutingPolicy exists: ${existingPolicy.name} (id=${existingPolicy.id})`);
  } else {
    const policy = await prisma.routingPolicy.create({
      data: {
        organizationId: org.id,
        scope: "ORGANIZATION",
        scopeId: org.id,
        name: "developer-default",
        isDefault: true,
        strategy: "priority",
        providerCredentialIds: [providerId],
        modelAllowlist: ["gpt-5-mini", "gpt-5", "gpt-4o", "gpt-4o-mini"],
      },
    });
    console.log(`[setup] created default RoutingPolicy id=${policy.id} → providers=[${providerId}]`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[setup] error:", err);
  process.exitCode = 1;
});
