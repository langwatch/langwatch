/**
 * mint-binding-token.ts — issue a UserIngestionBinding access token
 * (ik-lw-*) for fixture-fast-loop testing.
 *
 * Real users get a token by clicking "Install" in /me Trace Ingest,
 * which calls the same UserIngestionBindingService.install. There is
 * no UI path that emits raw OTLP claiming forged provenance keys, so
 * the forge-attempt regression must come from a wrapper script — this
 * one. Token printed to stdout in `ik-lw-*` form so it can be piped
 * directly into emit-otlp.sh:
 *
 *   TOKEN=$(npx tsx langwatch/scripts/dogfood/governance/mint-binding-token.ts \
 *     --user-email rogerio@langwatch.ai --template-slug claude_code | tail -1)
 *   ./langwatch/scripts/dogfood/governance/emit-otlp.sh \
 *     --binding-token "$TOKEN" --forge-attempt provenance --verbose
 *
 * The script writes a real DB row + audit log entry. Acceptable for
 * dev — these accumulate harmlessly. Use --uninstall-first to soft-
 * archive any pre-existing binding for the (user, template) pair so
 * subsequent runs revive with a fresh token.
 */
import { PrismaClient } from "@prisma/client";

import { UserIngestionBindingService } from "../../../ee/governance/services/userIngestionBinding.service";

interface CliArgs {
  userEmail: string;
  templateSlug: string;
  uninstallFirst: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const out: CliArgs = {
    userEmail: "",
    templateSlug: "claude_code",
    uninstallFirst: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--user-email") out.userEmail = args[++i] ?? "";
    else if (arg === "--template-slug") out.templateSlug = args[++i] ?? "";
    else if (arg === "--uninstall-first") out.uninstallFirst = true;
    else if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    } else {
      console.error(`unknown arg: ${arg}`);
      printUsage();
      process.exit(2);
    }
  }
  if (!out.userEmail) {
    console.error("--user-email is required");
    printUsage();
    process.exit(2);
  }
  return out;
}

function printUsage() {
  console.error(
    "Usage: tsx mint-binding-token.ts --user-email <email> [--template-slug <slug>] [--uninstall-first]",
  );
  console.error(
    "  --template-slug defaults to 'claude_code'. Slugs: claude_code|cursor|claude_cowork.",
  );
  console.error("  --uninstall-first soft-archives any existing binding first.");
}

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient();

  try {
    const user = await prisma.user.findUnique({
      where: { email: args.userEmail },
      select: { id: true, email: true },
    });
    if (!user) throw new Error(`user not found: ${args.userEmail}`);

    const orgUser = await prisma.organizationUser.findFirst({
      where: { userId: user.id },
      select: { organizationId: true },
      orderBy: { createdAt: "asc" },
    });
    if (!orgUser)
      throw new Error(`user ${args.userEmail} has no OrganizationUser row`);

    const template = await prisma.ingestionTemplate.findFirst({
      where: { slug: args.templateSlug, archivedAt: null },
      select: { id: true, slug: true, displayName: true },
    });
    if (!template)
      throw new Error(
        `template not found: slug=${args.templateSlug}. Run platform seeders or check slug.`,
      );

    const service = UserIngestionBindingService.create(prisma);

    if (args.uninstallFirst) {
      const existing = await prisma.userIngestionBinding.findFirst({
        where: { userId: user.id, templateId: template.id },
        select: { id: true, archivedAt: true },
      });
      if (existing && !existing.archivedAt) {
        try {
          await service.uninstall({
            callerUserId: user.id,
            organizationId: orgUser.organizationId,
            bindingId: existing.id,
          });
          console.error(`[mint] uninstalled prior binding for ${template.slug}`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[mint] uninstall failed: ${msg}`);
        }
      } else {
        console.error(`[mint] no prior binding to uninstall`);
      }
    }

    const result = await service.install({
      callerUserId: user.id,
      organizationId: orgUser.organizationId,
      templateId: template.id,
    });

    console.error(
      `[mint] binding ${result.binding.id} for user=${user.email} template=${template.slug} org=${orgUser.organizationId}`,
    );
    console.log(result.token);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
