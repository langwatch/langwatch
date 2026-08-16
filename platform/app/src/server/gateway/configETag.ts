/**
 * The version token for `GET /api/internal/gateway/config/:vk_id`.
 *
 * The gateway caches a materialised bundle per virtual key and revalidates it
 * with `If-None-Match` on a 60 second clock. A 304 tells the gateway that
 * everything in the bundle is still current, so the token has to move
 * whenever anything the bundle is built from moves.
 *
 * Two parts:
 *
 *   - `VirtualKey.revision`, which covers the key itself: its config, its
 *     scopes and its routing policy all bump it.
 *   - The provider rows of the key's organization, which the revision does
 *     not cover at all. A credential rotation writes `ModelProvider` and
 *     leaves every virtual key untouched, so a revision-only token answers
 *     304 to a bundle carrying the replaced key and the gateway keeps
 *     dispatching with it.
 *
 * The provider half is a digest of the rows themselves rather than an
 * aggregate over them. A newest-`updatedAt` summary is cheaper but not
 * correct: `updatedAt` is `TIMESTAMP(3)`, so two writes inside one
 * millisecond leave the summary where it was and the token stops tracking
 * the content. Digesting the fields the bundle is built from moves the token
 * whenever any of them differ, at any write rate, and it needs no row count
 * to notice a delete.
 *
 * It is deliberately organization-wide rather than a scope-cascade walk to
 * the exact rows one key reaches: one indexed read on the revalidation path,
 * which is the path that has to stay cheap. It over-invalidates, and the cost
 * of that is a re-materialise on the next refresh for keys in an organization
 * where some provider changed.
 *
 * This is the backstop, not the propagation path. `MODEL_PROVIDER_UPDATED`
 * on the change feed evicts within a poll, and that is what a rotation
 * through the API rides. The token is what covers a write the change feed
 * never saw, such as a seeding script or a migration writing straight to the
 * row.
 */
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";

export type ConfigETagKey = {
  organizationId: string;
  revision: bigint;
};

/**
 * The provider columns the materialised bundle reads. Anything the gateway
 * can act on belongs here, or a change to it will not move the token.
 */
const PROVIDER_DIGEST_COLUMNS = {
  id: true,
  provider: true,
  name: true,
  enabled: true,
  disabledAt: true,
  customKeys: true,
  extraHeaders: true,
  customModels: true,
  customEmbeddingsModels: true,
  deploymentMapping: true,
  providerConfig: true,
  rateLimitRpm: true,
  rateLimitTpm: true,
  rateLimitRpd: true,
  fallbackPriorityGlobal: true,
} as const;

export async function computeConfigETag({
  prisma,
  virtualKey,
}: {
  prisma: PrismaClient | Prisma.TransactionClient;
  virtualKey: ConfigETagKey;
}): Promise<string> {
  const providers = await prisma.modelProvider.findMany({
    where: { organizationId: virtualKey.organizationId },
    orderBy: { id: "asc" },
    select: PROVIDER_DIGEST_COLUMNS,
  });

  const digest = createHash("sha256")
    .update(
      JSON.stringify(providers, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    )
    .digest("hex")
    .slice(0, 16);

  return `${virtualKey.revision}.${digest}`;
}
