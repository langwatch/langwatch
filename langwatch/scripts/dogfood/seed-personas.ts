/**
 * Persona-aware chrome dogfood — seed Org/Team/Project for a signed-up user.
 *
 * Pairs with the better-auth /api/auth/sign-up/email flow:
 *   curl -X POST .../api/auth/sign-up/email -d '{"email":"...","password":"...","name":"..."}'
 *   pnpm tsx scripts/dogfood/seed-personas.ts --email <user-email> --persona <p1|p3|p4> [--mint-vk]
 *
 * Personas (from gateway.md Screen 6):
 *   p1 — personal-only (no Org/Team/Project). User remains an "anonymous IDE
 *        developer" who only has /me. Sign-up alone is sufficient.
 *   p3 — project-only (default LLMOps user, MEMBER on Org). Used to dogfood
 *        the regression-invariant "no Govern, no Gateway in sidebar" path.
 *        Even with FF on, MEMBER role keeps Govern/Gateway hidden.
 *   p4 — admin (ADMIN on Org). Used to dogfood the persona-4 chrome.
 *        Govern + Gateway visible, resolveHome → /governance.
 *
 * --mint-vk flag (any persona except p1): also mint a personal team +
 * personal project + personal VirtualKey for the user. Prints the VK
 * secret to stdout so a follow-up `fire-completion.ts` (or `langwatch
 * claude`) can fire a real LLM completion through the local Go gateway.
 * The secret is shown ONCE — capture it from script output.
 */
import { randomBytes } from "crypto";

import { prisma } from "~/server/db";
import { PersonalWorkspaceService } from "~/server/governance/personalWorkspace.service";
import { PersonalVirtualKeyService } from "~/server/governance/personalVirtualKey.service";

interface Args {
  email: string;
  persona: "p1" | "p3" | "p4";
  mintVk: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { mintVk: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") out.email = argv[++i] as string;
    else if (argv[i] === "--persona") out.persona = argv[++i] as Args["persona"];
    else if (argv[i] === "--mint-vk") out.mintVk = true;
  }
  if (!out.email) throw new Error("--email is required");
  if (!out.persona) throw new Error("--persona is required (p1|p3|p4)");
  return out as Args;
}

function shortId(): string {
  return randomBytes(4).toString("base64url").toLowerCase();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const user = await prisma.user.findUnique({ where: { email: args.email } });
  if (!user) throw new Error(`user ${args.email} not found — sign up first`);

  process.stderr.write(`[seed-personas] persona=${args.persona} user=${user.id}\n`);

  if (args.persona === "p1") {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
    process.stdout.write(JSON.stringify({ userId: user.id, persona: "p1" }) + "\n");
    return;
  }

  const orgRole = args.persona === "p4" ? "ADMIN" : "MEMBER";
  const teamRole = args.persona === "p4" ? "ADMIN" : "MEMBER";
  const orgSlug = `acme-${args.persona}-${shortId()}`;

  const org = await prisma.organization.create({
    data: {
      name: `Acme ${args.persona.toUpperCase()}`,
      slug: orgSlug,
      members: { create: { userId: user.id, role: orgRole } },
    },
  });

  const team = await prisma.team.create({
    data: {
      name: "Default Team",
      slug: `${orgSlug}-default`,
      organizationId: org.id,
      members: { create: { userId: user.id, role: teamRole } },
    },
  });

  const project = await prisma.project.create({
    data: {
      name: "Dogfood Project",
      slug: `${orgSlug}-default`,
      apiKey: `lw_pk_${randomBytes(24).toString("base64url")}`,
      teamId: team.id,
      language: "typescript",
      framework: "openai",
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true },
  });

  let vkOutput: { id: string; secret: string; baseUrl: string; personalProjectId: string } | null = null;
  if (args.mintVk) {
    const workspaceSvc = new PersonalWorkspaceService(prisma);
    const workspace = await workspaceSvc.ensure({
      userId: user.id,
      organizationId: org.id,
      displayName: user.name ?? null,
      displayEmail: user.email ?? args.email,
    });
    process.stderr.write(
      `[seed-personas] personal workspace ${workspace.created ? "created" : "found"}: team=${workspace.team.id} project=${workspace.project.id}\n`,
    );

    const vkSvc = PersonalVirtualKeyService.create(prisma, {
      gatewayBaseUrl: process.env.LW_GATEWAY_BASE_URL ?? "http://localhost:5563",
    });
    const issued = await vkSvc.issue({
      userId: user.id,
      organizationId: org.id,
      personalProjectId: workspace.project.id,
      personalTeamId: workspace.team.id,
      label: "dogfood",
    });
    vkOutput = {
      id: issued.id,
      secret: issued.secret,
      baseUrl: issued.baseUrl,
      personalProjectId: workspace.project.id,
    };
    process.stderr.write(
      `[seed-personas] minted personal VK id=${issued.id} routingPolicy=${issued.routingPolicyId ?? "none"}\n`,
    );
  }

  process.stdout.write(
    JSON.stringify({
      userId: user.id,
      organizationId: org.id,
      teamId: team.id,
      projectId: project.id,
      persona: args.persona,
      orgRole,
      ...(vkOutput ? { vk: vkOutput } : {}),
    }) + "\n",
  );
}

main()
  .catch((err) => {
    process.stderr.write(`[seed-personas] ERROR: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
