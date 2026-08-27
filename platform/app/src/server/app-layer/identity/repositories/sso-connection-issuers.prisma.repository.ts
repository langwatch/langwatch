import type { IdentityConnectionIssuersPort } from "@langwatch/identity-server/better-auth";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";

const logger = createLogger("langwatch:identity:connection-issuers");

/**
 * Which connection registered which issuer, over `SsoProvider`.
 *
 * The table already holds exactly this pair — `issuer` beside a unique
 * `providerId` — because registering a connection is what writes it. So the
 * mapping the legacy storage branch needs is a read of something a customer
 * already stated, never a guess derived from the shape of a string.
 *
 * CACHED, for the reason `registeredIssuers.ts` caches the same table: one
 * sign-in ceremony is several requests, each of which asks, and re-reading a
 * handful of rows for every one of them turns one sign-in into a burst of
 * identical queries. The window is short enough that a connection registered
 * a moment ago works on the administrator's first attempt — which is the case
 * that matters, because they are standing on the setup screen when they press
 * it.
 *
 * A read that fails answers "not a connection" rather than throwing. That
 * degrades to the behavior this replaced (an unanswerable issuer) instead of
 * taking down every sign-in of every kind, and it is logged at warn because a
 * database we cannot reach is a real fault even where it degrades.
 */
export class PrismaSsoConnectionIssuers
  implements IdentityConnectionIssuersPort
{
  /** Long enough to collapse one ceremony's requests, short enough that a
   *  just-registered connection is usable immediately. */
  private static readonly CACHE_TTL_MS = 5_000;

  private cached: {
    at: number;
    rows: Array<{ providerId: string; issuer: string }>;
  } | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * The one connection this issuer names, or none.
   *
   * AN ISSUER IS NOT A CONNECTION, and `find` pretended it was. Two
   * organizations can legitimately register the same issuer — a shared
   * multi-tenant endpoint like Entra's `/common/v2.0` is the ordinary case —
   * and `SsoProvider.issuer` carries no uniqueness because of it. Taking the
   * first row of an unordered `findMany` meant org B's returning member was
   * looked up under org A's connection, and which one that was could change
   * between deploys.
   *
   * SO AMBIGUITY ANSWERS NOTHING. A null here is "no rewrite", which the
   * caller already handles as no-match; the alternative was a confident
   * wrong answer that resolved somebody onto another tenant's account row.
   * Refusing to guess costs a sign-in that has to name its connection —
   * which the callback route does — and a wrong guess costs a stranger's
   * session.
   */
  async providerIdForIssuer({
    issuer,
  }: {
    issuer: string;
  }): Promise<string | null> {
    const rows = await this.rows();
    const matches = rows.filter((row) => row.issuer === issuer);
    if (matches.length === 1) return matches[0]?.providerId ?? null;
    if (matches.length > 1) {
      logger.warn(
        { issuer, connections: matches.length },
        "more than one connection registers this issuer; refusing to pick one",
      );
    }
    return null;
  }

  async registeredIssuerFor({
    providerId,
  }: {
    providerId: string;
  }): Promise<string | null> {
    const rows = await this.rows();
    return rows.find((row) => row.providerId === providerId)?.issuer ?? null;
  }

  private async rows(): Promise<Array<{ providerId: string; issuer: string }>> {
    const now = this.now();
    if (
      this.cached &&
      now - this.cached.at < PrismaSsoConnectionIssuers.CACHE_TTL_MS
    ) {
      return this.cached.rows;
    }

    try {
      const found = await this.prisma.ssoProvider.findMany({
        select: { providerId: true, issuer: true },
      });
      const rows = found.filter(
        (row): row is { providerId: string; issuer: string } =>
          typeof row.providerId === "string" &&
          typeof row.issuer === "string" &&
          row.issuer.length > 0,
      );
      this.cached = { at: now, rows };
      return rows;
    } catch (error) {
      logger.warn(
        { error },
        "could not read the registered single sign-on issuers; an issuer-keyed account read will answer no rows",
      );
      return this.cached?.rows ?? [];
    }
  }
}
