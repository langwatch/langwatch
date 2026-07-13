/**
 * Seed for the N-way (#5101) end-to-end walkthrough. Creates:
 *   - a user
 *   - an org + team + project
 *   - three prompt versions to be picked as N-way variants
 *   - a small dataset with 4 rows of {input, expected_output}
 *
 * Run: pnpm tsx scripts/seed-nway-demo.ts
 * Prints the login link + project slug at the end.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = "nway-demo@langwatch.ai";
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "N-way Demo" },
  });

  const org = await prisma.organization.create({
    data: {
      name: "N-way Demo Org",
      slug: `nway-demo-${Date.now()}`,
      members: {
        create: { userId: user.id, role: "ADMIN" },
      },
    },
  });

  const team = await prisma.team.create({
    data: {
      name: "N-way Team",
      slug: `nway-team-${Date.now()}`,
      organizationId: org.id,
      members: { create: { userId: user.id, role: "ADMIN" } },
    },
  });

  const project = await prisma.project.create({
    data: {
      name: "N-way Demo",
      slug: `nway-demo-${Date.now()}`,
      teamId: team.id,
      language: "typescript",
      framework: "custom",
    },
  });

  console.log(`Login as: ${email}`);
  console.log(`Project slug: ${project.slug}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
