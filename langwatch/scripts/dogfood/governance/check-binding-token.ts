/**
 * check-binding-token.ts — diagnostic helper that walks the same
 * hash-lookup path the receiver uses (`tokenResolver.resolveUserIngestionBinding`)
 * to explain why a given ik-lw-* token resolves or 401s. Use when
 * `emit-otlp.sh` returns 401 to find which check tripped.
 */
import { PrismaClient } from "@prisma/client";

import {
  hashBindingTokenBody,
  parseBindingToken,
} from "../../../ee/governance/services/userIngestionBindingToken.utils";

async function main() {
  const token = process.argv[2];
  if (!token) {
    console.error("Usage: tsx check-binding-token.ts <ik-lw-...>");
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const parsed = parseBindingToken(token);
    console.log("parsed:", parsed);
    if (!parsed) {
      console.error("ERR: parseBindingToken returned null — token shape rejected");
      return;
    }
    const hash = hashBindingTokenBody(parsed.body);
    console.log("hash[:16]:", hash.slice(0, 16));
    const b = await prisma.userIngestionBinding.findUnique({
      where: { bindingAccessTokenHash: hash },
      select: {
        id: true,
        enabled: true,
        archivedAt: true,
        bindingAccessTokenPrefix: true,
        userId: true,
        organizationId: true,
        personalProject: {
          select: {
            id: true,
            isPersonal: true,
            ownerUserId: true,
            archivedAt: true,
          },
        },
      },
    });
    console.log("binding lookup:", JSON.stringify(b, null, 2));
    if (!b) {
      console.error("ERR: no binding row matches hash");
      return;
    }
    if (b.archivedAt) console.error("ERR: binding archived");
    if (!b.enabled) console.error("ERR: binding not enabled");
    if (!b.personalProject) console.error("ERR: personalProject null");
    else if (b.personalProject.archivedAt)
      console.error("ERR: personalProject archived");
    else if (!b.personalProject.isPersonal)
      console.error("ERR: project.isPersonal=false (cross-bind invariant)");
    else if (b.personalProject.ownerUserId !== b.userId)
      console.error(
        `ERR: project.ownerUserId=${b.personalProject.ownerUserId} != binding.userId=${b.userId}`,
      );
    else console.log("OK: token would resolve");
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
