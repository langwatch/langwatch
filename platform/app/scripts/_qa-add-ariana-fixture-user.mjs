/**
 * Seed the sanitized fixture user `ariana@acme.test` so the captured
 * Claude Code OTLP fixture (specs/ai-governance/ingestion-sources/
 * fixtures/claude-code-2.1.129-otlp-capture.jsonl) round-trips through
 * the receiver's principal lookup without substitution.
 *
 * The captured payload's `user.email` was scrubbed to ariana@acme.test
 * during sanitization (separating "what the wire looks like" from
 * "which dev user replays it"). For the canonical extractor's
 * email→User lookup to land an actual ledger row, that email must
 * resolve to a User in the source's org — so we seed it.
 *
 * Idempotent. Org targeted: "Ariana Zone Co" (the dogfood org). User
 * is added as MEMBER of org + team. No password / login — this user
 * exists only as an attribution target.
 *
 * Run:
 *   node scripts/_qa-add-ariana-fixture-user.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORG_ID = "organization_0000HrVrdhNtZNrM5ysajP4tyK9Cq";
const TEAM_NAME = "Ariana Zone Co";
const EMAIL = "ariana@acme.test";

const team = await prisma.team.findFirst({
  where: { organizationId: ORG_ID, name: TEAM_NAME },
});
if (!team) {
  console.error(`team "${TEAM_NAME}" not found in org ${ORG_ID}`);
  process.exit(1);
}

const existing = await prisma.user.findFirst({ where: { email: EMAIL } });
let userId = existing?.id;
if (!existing) {
  const created = await prisma.user.create({
    data: {
      email: EMAIL,
      name: "Ariana (sanitized fixture user)",
      emailVerified: true,
    },
  });
  userId = created.id;
  console.log("created user", userId);
} else {
  console.log("user already exists", userId);
}

if (!userId) {
  console.error("failed to resolve user id");
  process.exit(1);
}

const orgUser = await prisma.organizationUser.findFirst({
  where: { userId, organizationId: ORG_ID },
});
if (!orgUser) {
  await prisma.organizationUser.create({
    data: { userId: userId, organizationId: ORG_ID, role: "MEMBER" },
  });
  console.log("added to org");
} else {
  console.log("org membership already exists");
}

const teamUser = await prisma.teamUser.findFirst({
  where: { userId, teamId: team.id },
});
if (!teamUser) {
  await prisma.teamUser.create({
    data: { userId, teamId: team.id, role: "MEMBER" },
  });
  console.log("added to team");
} else {
  console.log("team membership already exists");
}

const roleBinding = await prisma.roleBinding.findFirst({
  where: {
    userId,
    organizationId: ORG_ID,
    role: "MEMBER",
    scopeType: "ORGANIZATION",
    scopeId: ORG_ID,
    customRoleId: null,
  },
});
if (!roleBinding) {
  await prisma.roleBinding.create({
    data: {
      organizationId: ORG_ID,
      userId,
      role: "MEMBER",
      scopeType: "ORGANIZATION",
      scopeId: ORG_ID,
    },
  });
  console.log("added MEMBER RoleBinding (org scope)");
} else {
  console.log("RoleBinding already exists");
}

console.log(`done — ${EMAIL} is now a member of ${TEAM_NAME}`);
console.log(`fixture replay: principal lookup will resolve user.email → User.id=${userId}`);
await prisma.$disconnect();
