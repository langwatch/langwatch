/**
 * One-shot script to scrub stray real-customer-name contamination from
 * the dev DB. Replaces 'miro' with 'acme' in user emails, user names,
 * org names, and org slugs to align with the no-customer-names-in-public
 * convention.
 */
import { prisma } from "~/server/db";

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: "miro" } },
        { name: { contains: "Miro" } },
      ],
    },
    select: { id: true, email: true, name: true },
  });
  console.log(`[scrub] users found: ${users.length}`);
  for (const u of users) {
    const newEmail = u.email
      ?.replace(/@miro\./gi, "@acme.")
      .replace(/-miro-/g, "-acme-");
    const newName = u.name?.replace(/Miro/gi, "Acme");
    if (newEmail !== u.email || newName !== u.name) {
      await prisma.user.update({
        where: { id: u.id },
        data: { email: newEmail, name: newName },
      });
      console.log(`[scrub] user ${u.id}: ${u.email} → ${newEmail}`);
    }
  }

  const orgs = await prisma.organization.findMany({
    where: {
      OR: [
        { name: { contains: "Miro", mode: "insensitive" } },
        { slug: { contains: "miro" } },
      ],
    },
    select: { id: true, name: true, slug: true },
  });
  console.log(`[scrub] orgs found: ${orgs.length}`);
  for (const o of orgs) {
    const newName = o.name.replace(/Miro/gi, "Acme");
    const newSlug = o.slug.replace(/miro/g, "acme");
    if (newName !== o.name || newSlug !== o.slug) {
      await prisma.organization.update({
        where: { id: o.id },
        data: { name: newName, slug: newSlug },
      });
      console.log(`[scrub] org ${o.id}: ${o.slug} → ${newSlug}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[scrub] error:", err);
  process.exitCode = 1;
});
