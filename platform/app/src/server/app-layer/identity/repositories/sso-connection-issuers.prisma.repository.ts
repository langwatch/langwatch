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
 * THE PORT'S TWO READS ARE CACHED, for the reason the trusted-origin
 * allowlist caches the same table: one sign-in ceremony is several requests,
 * each of which asks, and re-reading a handful of rows for every one of them
 * turns one sign-in into a burst of identical queries. The window is short
 * enough that a connection registered a moment ago works on the
 * administrator's first attempt — which is the case that matters, because they
 * are standing on the setup screen when they press it.
 *
 * When one of those two fails it answers "not a connection" rather than
 * throwing. That degrades to the behavior this replaced (an unanswerable
 * issuer) instead of taking down every sign-in of every kind, and it is logged
 * at warn because a database we cannot reach is a real fault even where it
 * degrades. The two `find*` reads below are the trusted-origin allowlist's,
 * and they raise: what an unreadable table costs THAT caller is its own
 * decision, and it makes a different one.
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

  /**
   * One connection's issuer, read fresh, or null when it registered none.
   *
   * Deliberately outside the memo above. The trusted-origin allowlist asks
   * this on the common single sign-on path — every `/sso/callback/:providerId`
   * and SAML ACS names a connection — and a connection registered a moment ago
   * has to be dialable immediately. One row by unique key is a cheap query.
   *
   * Raises what it cannot read, unlike the memoized pair: whether an
   * unreadable table means "trust nothing" is the allowlist's decision, and
   * swallowing it here would take that decision away from it.
   */
  async findIssuerForConnection({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<string | null> {
    const row = await this.prisma.ssoProvider.findFirst({
      where: { providerId: connectionId },
      select: { issuer: true },
    });
    return row?.issuer ?? null;
  }

  /**
   * The `SsoProvider` row this connection registered, or none.
   *
   * Whether the LEGACY engine holds a provider for a connection, which is
   * half of what makes a connection dialable (D09). Read fresh and outside
   * the memo above for the reason `findIssuerForConnection` is: an
   * administrator standing on the setup screen has just written this row, and
   * a five-second answer of "no provider" reads to them as a broken save.
   *
   * The row rather than a boolean, so the caller states what absence means to
   * it rather than inheriting a question this class invented.
   */
  async findRegisteredProvider({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<{ id: string } | null> {
    return await this.prisma.ssoProvider.findFirst({
      where: { providerId: connectionId },
      select: { id: true },
    });
  }

  /** Every issuer any connection registered, read fresh and raising. */
  async findAllIssuers(): Promise<readonly string[]> {
    const rows = await this.prisma.ssoProvider.findMany({
      select: { issuer: true },
    });
    return rows
      .map((row) => row.issuer)
      .filter((issuer): issuer is string => !!issuer);
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
