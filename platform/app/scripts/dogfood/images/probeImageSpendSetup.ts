/**
 * The image spend probe's command line, its local-database guard and the
 * tenant and virtual key it provisions.
 *
 * These run before the probe issues a single HTTP call, and none of them
 * touch the gateway. Keeping them beside the orchestrator rather than inside
 * it leaves probe-image-spend.ts as the image calls and the run order.
 */

import { PersonalVirtualKeyService } from "@ee/governance/services/personalVirtualKey.service";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { prisma } from "~/server/db";
import type { ProbeScope } from "./probeImageSpendReads";
import { log } from "./probeImageSpendReport";

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface Args {
  email: string;
  org: string;
  gateway: string;
  model: string;
  quality: string;
  deadlineMs: number;
  shouldAllowRemoteDb: boolean;
}

export function parseArgs(argv: string[]): Args {
  let email = "";
  let org = "";
  let gateway = process.env.LW_GATEWAY_BASE_URL ?? "http://localhost:5563";
  let model = "gpt-image-2";
  let quality = "low";
  let deadlineMs = 60_000;
  let shouldAllowRemoteDb = false;
  // biome-ignore lint/style/useForOf: flag parser advances the index (argv[++i]) to consume a value; for...of has no index to advance.
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") email = argv[++i] ?? "";
    if (argv[i] === "--org") org = argv[++i] ?? "";
    if (argv[i] === "--gateway") gateway = argv[++i] ?? gateway;
    if (argv[i] === "--model") model = argv[++i] ?? model;
    if (argv[i] === "--quality") quality = argv[++i] ?? quality;
    if (argv[i] === "--deadline-ms") deadlineMs = Number(argv[++i] ?? 60_000);
    if (argv[i] === "--allow-remote-db") shouldAllowRemoteDb = true;
  }
  if (!email) throw new Error("--email is required");
  // A non-numeric or missing value parses to NaN, and every deadline
  // comparison against NaN is false, so the poll loop would run forever
  // instead of failing.
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new Error("--deadline-ms must be a positive number of milliseconds");
  }
  return {
    email,
    org,
    gateway: gateway.replace(/\/$/, ""),
    model,
    quality,
    deadlineMs,
    shouldAllowRemoteDb,
  };
}

/**
 * This probe issues a virtual key and a budget, so it only runs against a
 * local database by default. Pointing it at staging or prod by accident
 * would plant credentials on a shared tenant.
 */
export function assertLocalDatabase(shouldAllowRemoteDb: boolean): void {
  if (shouldAllowRemoteDb) return;
  const raw = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error("DATABASE_URL is unset or unparseable, refusing to run");
  }
  if (!LOCAL_DB_HOSTS.has(host)) {
    throw new Error(
      `DATABASE_URL points at ${host}, not a local database. ` +
        "Re-run with --allow-remote-db if you really mean it.",
    );
  }
}

export interface Tenant {
  userId: string;
  organizationId: string;
  projectId: string;
  teamId: string;
}

/**
 * The user's organization and personal workspace, read and ensured before
 * anything billable exists. The workspace is idempotent; the key and the
 * budget that follow are not, which is why the schema check sits between.
 */
export async function resolveTenant(args: Args): Promise<Tenant> {
  const user = await prisma.user.findFirst({ where: { email: args.email } });
  if (!user) throw new Error(`no user with email ${args.email}`);
  const orgs = await prisma.organization.findMany({
    where: { members: { some: { userId: user.id } } },
    select: { id: true, name: true },
  });
  if (orgs.length === 0) throw new Error(`${args.email} belongs to no org`);
  const picked = args.org
    ? orgs.find((o) => o.id === args.org || o.name === args.org)
    : orgs.length === 1
      ? orgs[0]
      : undefined;
  if (!picked) {
    throw new Error(
      `pass --org <id or name>, one of: ${orgs
        .map((o) => `${o.name} [${o.id}]`)
        .join(", ")}`,
    );
  }
  const providers = await prisma.modelProvider.count({
    where: { organizationId: picked.id, provider: "openai", enabled: true },
  });
  if (providers === 0) {
    throw new Error(
      "no enabled OpenAI provider on this org: run " +
        "scripts/dogfood/images/seed-images-vk.ts first",
    );
  }
  const workspace = await new PersonalWorkspaceService(prisma).ensure({
    userId: user.id,
    organizationId: picked.id,
    displayName: null,
    displayEmail: args.email,
  });
  return {
    userId: user.id,
    organizationId: picked.id,
    projectId: workspace.project.id,
    teamId: workspace.team.id,
  };
}

export interface Probe extends ProbeScope {
  vkSecret: string;
}

/** A virtual key and a budget of this run's own, so the delta is this run's. */
export async function provision({
  args,
  tenant,
}: {
  args: Args;
  tenant: Tenant;
}): Promise<Probe> {
  const issued = await PersonalVirtualKeyService.create(prisma, {
    gatewayBaseUrl: args.gateway,
  }).issue({
    userId: tenant.userId,
    organizationId: tenant.organizationId,
    personalProjectId: tenant.projectId,
    personalTeamId: tenant.teamId,
    label: `image-spend-probe-${Date.now()}`,
  });

  const budget = await prisma.gatewayBudget.create({
    data: {
      name: `image-spend-probe-${Date.now()}`,
      organizationId: tenant.organizationId,
      scopeType: "VIRTUAL_KEY",
      scopeId: issued.id,
      window: "MONTH",
      limitUsd: "100",
      // WARN, not BLOCK: the probe measures what a call costs, and a cap
      // that refused one would measure the cap instead.
      onBreach: "WARN",
      createdById: tenant.userId,
      resetsAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });

  log(`vk=${issued.id} budget=${budget.id} project=${tenant.projectId}`);
  return {
    vkSecret: issued.secret,
    vkId: issued.id,
    budgetId: budget.id,
    projectId: tenant.projectId,
    // Bounds every read to this run's window. Set after provisioning so the
    // predicate is as tight as the first call allows.
    startedAt: new Date(),
  };
}
