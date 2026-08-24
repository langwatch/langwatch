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
 *        [--max-members-lite 10000] \
 *        [--max-messages-per-month 10000000000] \
 *        [--expires-at 2030-02-05] \
 *        [--email ops@example.com]
 *
 *      Default plan: ENTERPRISE. Default max-members: 50. Default
 *      email: <orgSlug>@local.test. Everything else defaults to the
 *      plan template, so a contract with negotiated numbers has to
 *      pass them: the template's value is what gets enforced.
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

import { prisma as defaultPrisma } from "~/server/db";
import {
  LicenseGenerationService,
  NodeLicenseCryptographyAdapter,
} from "@langwatch/enterprise-licensing-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

interface ApplyLicenseInput {
  prisma: PrismaClient;
  organizationId: string;
  planType: string;
  /** Defaults to 50 — high enough that no realistic dev/QA org bumps the seat ceiling. */
  maxMembers?: number;
  /** Defaults to the plan template's value. */
  maxMembersLite?: number;
  /** Defaults to the plan template's value. */
  maxMessagesPerMonth?: number;
  /** Defaults to one year out. Must be in the future. */
  expiresAt?: Date;
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

  const { licenseKey, licenseData } = LicenseGenerationService.create(
    NodeLicenseCryptographyAdapter.create(),
  ).generate({
    organizationName: org.name,
    email,
    planType: input.planType,
    maxMembers,
    ...(input.maxMembersLite !== undefined
      ? { maxMembersLite: input.maxMembersLite }
      : {}),
    ...(input.maxMessagesPerMonth !== undefined
      ? { maxMessagesPerMonth: input.maxMessagesPerMonth }
      : {}),
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    privateKey: input.privateKey,
  });

  await input.prisma.organization.update({
    where: { id: org.id },
    data: {
      license: licenseKey,
      licenseExpiresAt: new Date(licenseData.expiresAt),
      // Cleared so the stamp describes this license rather than the one it
      // replaced. Nothing reads it as a cache or a TTL: the license is read
      // from this row and verified on every request, so the new one takes
      // effect on the next call either way.
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
  maxMembersLite?: number;
  maxMessagesPerMonth?: number;
  expiresAt?: Date;
  email?: string;
}

/**
 * A quota is a whole number of seats or messages, so anything else is a typo
 * worth stopping on. `Number.parseInt` would read "50GB" as 50 and "1.9" as 1,
 * and the operator would sign a license carrying a number they never asked
 * for.
 */
function parseQuota(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    process.stderr.write(
      `Error: ${flag} must be a whole number, got: ${value}\n\n`,
    );
    printUsage();
    process.exit(2);
  }
  return parsed;
}

/**
 * `new Date("2025-02-31")` rolls forward to March 3rd rather than refusing, so
 * a mistyped day silently mints a license expiring on a date nobody chose. The
 * round trip through the parsed date is what catches it.
 */
function parseExpiresAt(value: string): Date {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(Number.NaN);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    process.stderr.write(
      `Error: --expires-at must be a calendar date as YYYY-MM-DD, got: ${value}\n\n`,
    );
    printUsage();
    process.exit(2);
  }
  return parsed;
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
      args.maxMembers = parseQuota(flag, value);
      i++;
    } else if (flag === "--max-members-lite" && value) {
      args.maxMembersLite = parseQuota(flag, value);
      i++;
    } else if (flag === "--max-messages-per-month" && value) {
      args.maxMessagesPerMonth = parseQuota(flag, value);
      i++;
    } else if (flag === "--expires-at" && value) {
      args.expiresAt = parseExpiresAt(value);
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
      "      [--max-members-lite <N>]         (default: the plan template)",
      "      [--max-messages-per-month <N>]   (default: the plan template)",
      "      [--expires-at <YYYY-MM-DD>]      (default: one year out)",
      "      [--email <addr>]                 (default: <orgSlug>@local.test)",
      "",
      "Anything left off is minted from the plan template, so pass the numbers",
      "a negotiated contract sets or the license will enforce the template's.",
      "",
      "Reads LANGWATCH_LICENSE_PRIVATE_KEY from env. The matching public",
      "key must be set as LANGWATCH_LICENSE_PUBLIC_KEY for the runtime",
      "license-enforcement layer to verify it.",
      "",
      "Writes Organization.license directly. It does not go through",
      "validateAndStoreLicense, so it provisions no retention rules.",
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
        "Add it to platform/app/.env (paired with LANGWATCH_LICENSE_PUBLIC_KEY) " +
        "and re-run.\n",
    );
    process.exit(2);
  }

  const result = await applyLicenseToOrg({
    prisma: defaultPrisma,
    organizationId: args.orgId,
    planType: args.plan,
    maxMembers: args.maxMembers,
    maxMembersLite: args.maxMembersLite,
    maxMessagesPerMonth: args.maxMessagesPerMonth,
    expiresAt: args.expiresAt,
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
