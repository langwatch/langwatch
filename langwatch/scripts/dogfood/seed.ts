/**
 * Lane-B iter 24 — deterministic dogfood seed for Sergey 3a (ActivityMonitorService rewire).
 *
 * Mints a fresh org + team + user + ADMIN OrganizationUser + IngestionSource
 * via Prisma. Inlines the secret-gen + hash logic from
 * IngestionSourceService.createSource so this script doesn't depend on
 * the service module being importable from outside the langwatch/ workspace
 * (tsx + ESM + the monorepo layout sometimes mis-resolves named exports
 * when the importer lives outside langwatch/node_modules).
 *
 * Outputs the resolved IDs and the raw ingest secret as a single JSON
 * line on stdout so a shell wrapper can consume + curl-post a real
 * OTLP span.
 *
 * Why deterministic shell + tsx (not pnpm dev clicks): iter loop on Sergey 3a
 * needs sub-30s 'post → check dashboard → diff' to be useful. UI-clicks
 * through composer are too slow to retry.
 *
 * Usage (from worktree root):
 *   cd langwatch && pnpm tsx ../.monitor-logs/lane-b-dogfood/seed.ts \
 *     --source-type otel_generic --namespace dogfood
 *
 * Output (one JSON line on stdout, logs on stderr):
 *   {"organizationId":"...","teamId":"...","userId":"...","ingestionSourceId":"...","ingestSecret":"lw_is_...","sourceType":"otel_generic","namespace":"dogfood-..."}
 */
import { createHash, randomBytes } from "crypto";

import { env } from "~/env.mjs";
import { prisma } from "~/server/db";

type SourceType = "otel_generic" | "claude_cowork" | "workato" | "s3_custom";

interface Args {
  sourceType: SourceType;
  namespace: string;
}

function shortId(): string {
  return randomBytes(6).toString("base64url");
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { sourceType: "otel_generic" };
  let nsRoot = "dogfood";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--source-type") {
      out.sourceType = argv[++i] as SourceType;
    } else if (arg === "--namespace") {
      nsRoot = argv[++i] ?? "dogfood";
    }
  }
  out.namespace = `${nsRoot}-${shortId()}`;
  return out as Args;
}

function generateIngestSecret(): string {
  return `lw_is_${randomBytes(32).toString("base64url")}`;
}

function hashIngestSecret(rawSecret: string): string {
  const pepper = env.LW_VIRTUAL_KEY_PEPPER ?? "";
  return createHash("sha256")
    .update(`${pepper}::${rawSecret}`)
    .digest("base64url");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ns = args.namespace;

  process.stderr.write(
    `[seed] minting org/team/user/source for namespace=${ns} sourceType=${args.sourceType}\n`,
  );

  const org = await prisma.organization.create({
    data: {
      name: `Dogfood Org ${ns}`,
      slug: `dogfood-org-${ns}`,
    },
  });
  const team = await prisma.team.create({
    data: {
      name: `Dogfood Team ${ns}`,
      slug: `dogfood-team-${ns}`,
      organizationId: org.id,
    },
  });
  const user = await prisma.user.create({
    data: {
      email: `dogfood-${ns}@example.com`,
      name: `Dogfood User ${ns}`,
    },
  });
  await prisma.organizationUser.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      role: "ADMIN",
    },
  });

  const ingestSecret = generateIngestSecret();
  const ingestSecretHash = hashIngestSecret(ingestSecret);
  const source = await prisma.ingestionSource.create({
    data: {
      organizationId: org.id,
      teamId: null,
      sourceType: args.sourceType,
      name: `Dogfood Source ${ns}`,
      description: null,
      ingestSecretHash,
      parserConfig: {},
      retentionClass: "thirty_days",
      status: "awaiting_first_event",
      createdById: user.id,
    },
  });

  const result = {
    organizationId: org.id,
    teamId: team.id,
    userId: user.id,
    ingestionSourceId: source.id,
    ingestSecret,
    sourceType: args.sourceType,
    namespace: ns,
  };
  process.stdout.write(JSON.stringify(result) + "\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  process.stderr.write(`[seed] error: ${String(err)}\n`);
  process.exitCode = 1;
});
