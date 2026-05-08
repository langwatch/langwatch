/**
 * Mint a signed license for a LangWatch organization.
 *
 * Replaces the LANGWATCH_DEV_FORCE_ENTERPRISE escape hatch (deleted by
 * sergey-2 alongside this script) with a real-license code path: dev,
 * QA, and self-hosted ops orgs all get the same plan-resolution
 * pipeline production uses, just with a key the operator generates
 * locally from their LANGWATCH_LICENSE_PRIVATE_KEY.
 *
 * Two entry points:
 *
 *   1. CLI — operator runs ad-hoc against a known org id:
 *
 *      LANGWATCH_LICENSE_PRIVATE_KEY="$(cat private.pem)" \
 *      pnpm tsx scripts/generate-license.ts \
 *        --org-id <organizationId> \
 *        --plan ENTERPRISE \
 *        [--max-members 50] \
 *        [--email ops@example.com]
 *
 *      Default plan: ENTERPRISE. Default max-members: 50. Default
 *      email: <orgSlug>@local.test.
 *
 *   2. Programmatic — seed/QA scripts import { applyLicenseToOrg }:
 *
 *      await applyLicenseToOrg({
 *        prisma,
 *        organizationId,
 *        planType: "ENTERPRISE",
 *        privateKey: process.env.LANGWATCH_LICENSE_PRIVATE_KEY!,
 *      });
 *
 * Security: the private key is never written to PG or logged. Only
 * the signed `licenseKey` (already public-key-verifiable) lands on
 * Organization.license. Treat the private key like any other prod
 * secret — pair it with the public key declared in env-create.mjs.
 */
import type { PrismaClient } from "@prisma/client";

import { generateLicenseKey } from "../ee/licensing/licenseGenerationService";
import { prisma as defaultPrisma } from "~/server/db";

interface ApplyLicenseInput {
  prisma: PrismaClient;
  organizationId: string;
  planType: string;
  /** Defaults to 50 — high enough that no realistic dev/QA org bumps the seat ceiling. */
  maxMembers?: number;
  /** Defaults to `<orgSlug>@local.test`. */
  email?: string;
  privateKey: string;
}

interface ApplyLicenseResult {
  organizationId: string;
  organizationName: string;
  planType: string;
  licenseId: string;
  expiresAt: string;
}

export async function applyLicenseToOrg(
  input: ApplyLicenseInput,
): Promise<ApplyLicenseResult> {
  const org = await input.prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true, slug: true },
  });
  if (!org) {
    throw new Error(
      `Organization ${input.organizationId} not found — pass an existing org id`,
    );
  }

  const email = input.email ?? `${org.slug}@local.test`;
  const maxMembers = input.maxMembers ?? 50;

  const { licenseKey, licenseData } = generateLicenseKey({
    organizationName: org.name,
    email,
    planType: input.planType,
    maxMembers,
    privateKey: input.privateKey,
  });

  await input.prisma.organization.update({
    where: { id: org.id },
    data: {
      license: licenseKey,
      licenseExpiresAt: new Date(licenseData.expiresAt),
      // Force the next request through the validation cache so the new
      // license takes effect immediately instead of waiting for the
      // licenseLastValidatedAt TTL.
      licenseLastValidatedAt: null,
    },
  });

  return {
    organizationId: org.id,
    organizationName: org.name,
    planType: licenseData.plan.type,
    licenseId: licenseData.licenseId,
    expiresAt: licenseData.expiresAt,
  };
}

interface CliArgs {
  orgId: string;
  plan: string;
  maxMembers?: number;
  email?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = { plan: "ENTERPRISE" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--org-id" && value) {
      args.orgId = value;
      i++;
    } else if (flag === "--plan" && value) {
      args.plan = value.toUpperCase();
      i++;
    } else if (flag === "--max-members" && value) {
      args.maxMembers = Number.parseInt(value, 10);
      i++;
    } else if (flag === "--email" && value) {
      args.email = value;
      i++;
    } else if (flag === "--help" || flag === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  if (!args.orgId) {
    process.stderr.write("Error: --org-id is required\n\n");
    printUsage();
    process.exit(2);
  }
  return args as CliArgs;
}

function printUsage() {
  process.stderr.write(
    [
      "Mint a signed license for a LangWatch organization.",
      "",
      "Usage:",
      "  LANGWATCH_LICENSE_PRIVATE_KEY=$(cat private.pem) \\",
      "    pnpm tsx scripts/generate-license.ts \\",
      "      --org-id <organizationId> \\",
      "      [--plan ENTERPRISE|GROWTH|PRO]   (default: ENTERPRISE)",
      "      [--max-members <N>]              (default: 50)",
      "      [--email <addr>]                 (default: <orgSlug>@local.test)",
      "",
      "Reads LANGWATCH_LICENSE_PRIVATE_KEY from env. The matching public",
      "key must be set as LANGWATCH_LICENSE_PUBLIC_KEY for the runtime",
      "license-enforcement layer to verify it.",
      "",
    ].join("\n"),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const privateKey = process.env.LANGWATCH_LICENSE_PRIVATE_KEY;
  if (!privateKey) {
    process.stderr.write(
      "Error: LANGWATCH_LICENSE_PRIVATE_KEY is not set in env. " +
        "Add it to langwatch/.env (paired with LANGWATCH_LICENSE_PUBLIC_KEY) " +
        "and re-run.\n",
    );
    process.exit(2);
  }

  const result = await applyLicenseToOrg({
    prisma: defaultPrisma,
    organizationId: args.orgId,
    planType: args.plan,
    maxMembers: args.maxMembers,
    email: args.email,
    privateKey,
  });

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        organizationId: result.organizationId,
        organizationName: result.organizationName,
        planType: result.planType,
        licenseId: result.licenseId,
        expiresAt: result.expiresAt,
      },
      null,
      2,
    ) + "\n",
  );
}

// Run only when invoked as a script (not when imported by a seed
// helper). Tsx + node-mode behave alike — argv[1] is the entry path.
if (
  process.argv[1] &&
  /generate-license\.ts$|generate-license\.js$/.test(process.argv[1])
) {
  main()
    .catch((err) => {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(1);
    })
    .finally(() => {
      void defaultPrisma.$disconnect();
    });
}
