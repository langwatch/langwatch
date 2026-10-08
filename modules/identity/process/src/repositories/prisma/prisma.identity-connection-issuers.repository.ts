import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { IdentityConnectionIssuersRepository } from "../identity-connection-issuers.repository.ts";

const logger = createLogger("langwatch:identity:connection-issuers");

type PrismaConnectionIssuersDatabase = Pick<PrismaClient, "ssoProvider">;
type IssuerRow = { providerId: string; issuer: string };

/** Long enough to collapse one ceremony's requests, short enough for a just-registered one. */
const CACHE_TTL_MS = 5_000;

/**
 * `SsoProvider(providerId, issuer)`, cached. A failed
 * read degrades to the last rows read (or none) and is logged, never failing every sign-in.
 */
export class PrismaIdentityConnectionIssuersRepository extends IdentityConnectionIssuersRepository {
  static create(
    database: PrismaConnectionIssuersDatabase,
    now: () => number = Date.now,
  ): PrismaIdentityConnectionIssuersRepository {
    return new PrismaIdentityConnectionIssuersRepository(database, now);
  }

  private cached: { at: number; rows: IssuerRow[] } | null = null;

  private constructor(
    private readonly database: PrismaConnectionIssuersDatabase,
    private readonly now: () => number,
  ) {
    super();
  }

  async findProviderIdsForIssuer({ issuer }: { issuer: string }): Promise<string[]> {
    return (await this.rows()).filter((row) => row.issuer === issuer).map((row) => row.providerId);
  }

  async findRegisteredIssuers({ providerId }: { providerId: string }): Promise<string[]> {
    return (await this.rows())
      .filter((row) => row.providerId === providerId)
      .map((row) => row.issuer);
  }

  private async rows(): Promise<IssuerRow[]> {
    const at = this.now();
    if (this.cached !== null && at - this.cached.at < CACHE_TTL_MS) return this.cached.rows;
    try {
      const rows = await this.database.ssoProvider.findMany({
        select: { providerId: true, issuer: true },
      });
      this.cached = { at, rows };
      return rows;
    } catch (error) {
      logger.warn(
        { err: error },
        "could not read connection issuers; answering from the last read",
      );
      return this.cached?.rows ?? [];
    }
  }
}
