/**
 * The version token for `GET /api/internal/gateway/config/:vk_id`.
 *
 * The gateway caches a materialised bundle per virtual key and revalidates it
 * with `If-None-Match` on a 60 second clock. A 304 tells the gateway that
 * everything in the bundle is still current, so the token has to move
 * whenever anything the bundle is built from moves.
 *
 * Two parts.
 *
 * `VirtualKey.revision` covers the key itself: its config, its scopes, its
 * routing policy link, its status and its expiry all bump it through
 * `VirtualKeyService`.
 *
 * The provider digest covers the dispatch chain, which the revision does not
 * reach at all. A credential rotation writes `ModelProvider`, and a grant or
 * a revoke writes `ModelProviderScope`; neither touches any virtual key, so a
 * revision-only token answers 304 to a bundle built from providers that have
 * since changed, moved out of reach, or just come into it.
 *
 * The digest is taken over `eligibleModelProvidersForVk`, the same resolver
 * the materialiser calls to build `providers[]`, rather than over a query
 * written here. That is deliberate. A hand-written approximation of the
 * provider set has to be kept in step with the resolver by hand, and each
 * time it fell behind the token stopped tracking something the bundle reads:
 * first the provider columns, then the scope relation that decides
 * reachability at all, then the ordering that `fallbackPriorityGlobal` and
 * `createdAt` settle. Digesting the resolver's own output cannot fall behind
 * it, because it is the thing the bundle is built from.
 *
 * So the token moves for: a rotated or edited credential, a provider enabled
 * or disabled or withdrawn, a scope row granted or revoked at any level, a
 * routing policy that reorders or drops a provider, and a change of dispatch
 * order. It moves whether the write went through the service or straight to
 * the row, which is the point: this is the backstop for writes the change
 * feed never saw, such as a seeding script or a migration.
 *
 * What it does not cover, by decision rather than oversight: budgets, cache
 * rules and guardrails. Each already emits its own change event
 * (`BUDGET_*`, `CACHE_RULE_*`, `ROUTING_POLICY_*`), and reproducing their
 * resolvers here would mean three more reads on the revalidation path plus
 * three more copies to keep in step. A direct write to one of those tables
 * is bounded by the change feed, not by this token.
 *
 * Spend is excluded for a different reason: it changes continuously, so
 * folding it in would move the token on nearly every revalidation and there
 * would be no 304s left to save anything.
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "~/generated/prisma/client";
import { eligibleModelProvidersForVk } from "./scopeResolver";
import type { VirtualKeyWithScopes } from "./virtualKey.repository";

export async function computeConfigETag({
  prisma,
  virtualKey,
}: {
  prisma: PrismaClient;
  virtualKey: VirtualKeyWithScopes;
}): Promise<string> {
  const providers = await eligibleModelProvidersForVk(prisma, virtualKey);

  // Order is part of the answer: `providers[]` is the fallback chain, so two
  // identical sets in a different order are two different bundles. The array
  // comes back in dispatch order, and it is digested as it comes.
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
