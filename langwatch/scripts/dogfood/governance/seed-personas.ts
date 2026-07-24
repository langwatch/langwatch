/**
 * Persona-aware chrome dogfood — seed Org/Team/Project for a signed-up user.
 *
 * Pairs with the better-auth /api/auth/sign-up/email flow:
 *   curl -X POST .../api/auth/sign-up/email -d '{"email":"...","password":"...","name":"..."}'
 *   pnpm tsx scripts/dogfood/governance/seed-personas.ts --email <user-email> --persona <p1|p3|p4> [--mint-vk]
 *
 * No password-mint — this script REQUIRES the user already signed up
 * through the auth flow. Operator drives sign-up out-of-band; this
 * script never touches the User row's credential material, only its
 * org/team/project membership state.
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
 *
 * --mint-vk in detail: the script seeds an org-default ModelProvider +
 * RoutingPolicy so the personal VK has a routing chain to bind to.
 * When `OPENAI_API_KEY` is set in env, an OpenAI ModelProvider is
 * seeded with that key. When not set, the ModelProvider step is
 * skipped with a warning — the VK is still issued, but it won't route
 * any traffic until an admin attaches a provider through the UI.
 * Production demo seeding deliberately runs without OPENAI_API_KEY in
 * env so personal VKs get minted without the script knowing the real
 * provider key.
 *
 * Why this script is NOT a cron SeedAction: per-user setup tied to a
 * specific signed-up email. The cron path (seed-demo) reset's job is
 * to refresh populated state in an already-provisioned demo org, not
 * to provision new personas. Operator runs this script once per demo
 * persona during environment setup; cron tops up the data afterwards.
 */
import { randomBytes } from "crypto";
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";

import { prisma } from "~/server/db";
import { encrypt } from "~/utils/encryption";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { PersonalVirtualKeyService } from "@ee/governance/services/personalVirtualKey.service";

export interface SeedPersonasArgs {
  email: string;
  persona: "p1" | "p3" | "p4";
  mintVk: boolean;
}

export interface SeedPersonasSummary {
  userId: string;
  persona: SeedPersonasArgs["persona"];
  organizationId?: string;
  teamId?: string;
  projectId?: string;
  orgRole?: "ADMIN" | "MEMBER";
  vk?: {
    id: string;
    secret: string;
    baseUrl: string;
    personalProjectId: string;
  };
  modelProviderSeeded: boolean;
}

function parseArgs(argv: string[]): SeedPersonasArgs {
  const out: Partial<SeedPersonasArgs> = { mintVk: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") out.email = argv[++i] as string;
    else if (argv[i] === "--persona") out.persona = argv[++i] as SeedPersonasArgs["persona"];
    else if (argv[i] === "--mint-vk") out.mintVk = true;
  }
  if (!out.email) throw new Error("--email is required");
  if (!out.persona) throw new Error("--persona is required (p1|p3|p4)");
  return out as SeedPersonasArgs;
}

function shortId(): string {
  return randomBytes(4).toString("base64url").toLowerCase();
}

export async function runSeedPersonas(
  args: SeedPersonasArgs,
): Promise<SeedPersonasSummary> {
  const user = await prisma.user.findUnique({ where: { email: args.email } });
  if (!user) throw new Error(`user ${args.email} not found — sign up first`);

  process.stderr.write(`[seed-personas] persona=${args.persona} user=${user.id}\n`);

  if (args.persona === "p1") {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
    return {
      userId: user.id,
      persona: "p1",
      modelProviderSeeded: false,
    };
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

  let vkOutput: SeedPersonasSummary["vk"];
  let modelProviderSeeded = false;
  if (args.mintVk) {
    // Seed an org-default RoutingPolicy + ModelProvider so PersonalVK
    // issuance has a chain to bind to. When OPENAI_API_KEY is set, the
    // ModelProvider step runs and the personal VK can route end-to-end.
    // When not set, we skip ModelProvider + RoutingPolicy and the VK is
    // still issued — production-demo path runs the cron without a real
    // provider key in env, the admin attaches credentials through the
    // UI separately.
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      const modelProvider = await prisma.modelProvider.create({
        data: {
          name: "OpenAI",
          provider: "openai",
          enabled: true,
          organizationId: org.id,
          // customKeys is an AES-GCM encrypted JSON blob, not a plain
          // object. config.materialiser decrypts and pick()s
          // OPENAI_API_KEY before handing it to the gateway. Empty {}
          // produces {api_key: ""} and the gateway 504s.
          customKeys: encrypt(JSON.stringify({ OPENAI_API_KEY: openaiKey })),
          scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: org.id }] },
        },
      });
      // RoutingPolicy.modelProviderIds points at ModelProvider directly
      // post-collapse.
      const policy = await prisma.routingPolicy.create({
        data: {
          organizationId: org.id,
          scopes: {
            create: [{ scopeType: "ORGANIZATION", scopeId: org.id }],
          },
          name: "developer-default",
          isDefault: true,
          strategy: "priority",
          modelProviderIds: [modelProvider.id],
          modelAllowlist: ["gpt-5-mini", "gpt-5", "gpt-4o", "gpt-4o-mini"],
        },
      });
      modelProviderSeeded = true;
      process.stderr.write(
        `[seed-personas] seeded org modelProvider=${modelProvider.id} routing-policy=${policy.id} (org-default)\n`,
      );
    } else {
      process.stderr.write(
        `[seed-personas] OPENAI_API_KEY not set — skipping ModelProvider + RoutingPolicy seed. Personal VK will issue but won't route until an admin attaches a provider.\n`,
      );
    }

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

    // Personal $1/month BLOCK budget so a live-fire loop (fire-completion
    // or `langwatch claude`) actually populates gateway_budget_ledger_events
    // out-of-box. Without this, traces ingest cleanly but the trace-fold
    // reactor finds zero applicable budgets and skips the ledger insert.
    // Idempotent per (org, principal) — finds existing or creates.
    const existingBudget = await prisma.gatewayBudget.findFirst({
      where: {
        organizationId: org.id,
        scopeType: "PRINCIPAL",
        scopeId: user.id,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!existingBudget) {
      const budget = await prisma.gatewayBudget.create({
        data: {
          organizationId: org.id,
          scopeType: "PRINCIPAL",
          scopeId: user.id,
          createdById: user.id,
          name: `Personal Budget — ${args.email}`,
          description: "Auto-seeded by seed-personas.ts --mint-vk",
          window: "MONTH",
          limitUsd: "1.000000",
          onBreach: "BLOCK",
          timezone: "UTC",
          currentPeriodStartedAt: new Date(),
          resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
        select: { id: true },
      });
      process.stderr.write(
        `[seed-personas] seeded personal budget id=${budget.id} ($1/MONTH BLOCK)\n`,
      );
    } else {
      process.stderr.write(
        `[seed-personas] reusing existing personal budget id=${existingBudget.id}\n`,
      );
    }
  }

  return {
    userId: user.id,
    persona: args.persona,
    organizationId: org.id,
    teamId: team.id,
    projectId: project.id,
    orgRole,
    vk: vkOutput,
    modelProviderSeeded,
  };
}

// CLI bootstrap — only fires when this file is the entry point.
const isCliInvocation =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isCliInvocation) {
  const args = parseArgs(process.argv.slice(2));
  runSeedPersonas(args)
    .then((summary) => {
      process.stdout.write(JSON.stringify(summary) + "\n");
    })
    .catch((err) => {
      process.stderr.write(`[seed-personas] ERROR: ${err.message}\n${err.stack}\n`);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
