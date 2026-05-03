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
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";

import { prisma } from "~/server/db";
import { encrypt } from "~/utils/encryption";
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

  // Mirror the production org-create flow (OrganizationPrismaRepository
  // .createAndAssign at lines 217-237). Production seeds two RoleBindings
  // per new org: ORGANIZATION-scoped + TEAM-scoped, both at the user's
  // role. Without these the new `hasOrganizationPermission` resolver
  // falls into the legacy TeamUser path which only consults
  // `teamRoleHasPermission` — and the team-role bag has no
  // `organization:view` entry, so the user 401s on every org-scoped
  // procedure (incl. `governance.resolveHome`, the persona-aware
  // `/` redirect path the chrome relies on). Iter33 chrome dogfood
  // surfaced this when seed-personas-created MEMBER 401d on
  // resolveHome despite the carve-out (see PR doc §"RBAC
  // defense-in-depth → Open thread", `9e373c284`).
  const rbRole =
    teamRole === "ADMIN" ? TeamUserRole.ADMIN : TeamUserRole.MEMBER;
  await prisma.roleBinding.createMany({
    data: [
      {
        organizationId: org.id,
        userId: user.id,
        role: rbRole,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: org.id,
      },
      {
        organizationId: org.id,
        userId: user.id,
        role: rbRole,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: team.id,
      },
    ],
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
    // Seed an org-default RoutingPolicy + ModelProvider so PersonalVK
    // issuance has a chain to bind to. Without this the VK service
    // falls into the "needs explicit credentials" branch and 400s
    // ("At least one provider credential is required"). Idempotent
    // per (org, scope, isDefault).
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      throw new Error(
        "OPENAI_API_KEY required in env for --mint-vk so seeded ModelProvider can route through Go gateway",
      );
    }
    const modelProvider = await prisma.modelProvider.create({
      data: {
        projectId: project.id,
        name: "OpenAI",
        provider: "openai",
        enabled: true,
        // customKeys is an AES-GCM encrypted JSON blob, not a plain object —
        // config.materialiser decrypts and pick()s OPENAI_API_KEY off it
        // before handing the value to the gateway. An empty {} produces
        // {api_key: ""} downstream and the gateway 504s with
        // "provider is required". (Sergey root-cause, iter29 dogfood.)
        customKeys: encrypt(JSON.stringify({ OPENAI_API_KEY: openaiKey })),
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: org.id }] },
      },
    });
    // GatewayProviderCredential wraps ModelProvider for gateway routing —
    // RoutingPolicy.providerCredentialIds expects GatewayProviderCredential
    // ids, NOT ModelProvider ids.
    const gatewayCred = await prisma.gatewayProviderCredential.create({
      data: {
        projectId: project.id,
        modelProviderId: modelProvider.id,
        slot: "primary",
      },
    });
    const policy = await prisma.routingPolicy.create({
      data: {
        organizationId: org.id,
        scope: "organization",
        scopeId: org.id,
        name: "developer-default",
        isDefault: true,
        strategy: "priority",
        providerCredentialIds: [gatewayCred.id],
        modelAllowlist: ["gpt-5-mini", "gpt-5", "gpt-4o", "gpt-4o-mini"],
      },
    });
    process.stderr.write(
      `[seed-personas] seeded org modelProvider=${modelProvider.id} gatewayCred=${gatewayCred.id} routing-policy=${policy.id} (org-default)\n`,
    );

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
