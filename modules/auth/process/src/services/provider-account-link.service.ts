import { providerAccountIssuer } from "../rules/provider-account-issuer.rules.ts";
import type { SsoIssuerDirectory } from "./sso-registered-issuers.service.ts";

/** The account row Better Auth writes, keyed `(providerId, accountId)`; `issuer` is ours
 *  (ADR-189). */
export type ProviderAccountRow = Readonly<{
  userId: string;
  providerId: string;
  issuer: string;
  accountId: string;
}>;

/** Better Auth's own account write, so its account hooks run as for any sign-in. */
export interface ProviderAccountWriter {
  createAccount(row: ProviderAccountRow): Promise<void>;
}

interface ProviderAccountLinkServiceDeps {
  issuers: Pick<SsoIssuerDirectory, "findIssuersForConnection">;
  accounts: ProviderAccountWriter;
}

/**
 * How a confirmed link proposal becomes a sign-in method. It writes through Better Auth
 * and nowhere else, so no second path can claim an account row. A connection's proposal
 * keys the row by the connection, as that connection's own sign-ins do.
 */
export class ProviderAccountLinkService {
  static create(deps: ProviderAccountLinkServiceDeps): ProviderAccountLinkService {
    return new ProviderAccountLinkService(deps);
  }

  private constructor(private readonly deps: ProviderAccountLinkServiceDeps) {}

  async link({
    userId,
    connectionId,
    provider,
    subject,
  }: {
    userId: string;
    connectionId: string | null;
    provider: string;
    subject: string;
  }): Promise<void> {
    const [connectionIssuer] =
      connectionId === null
        ? []
        : await this.deps.issuers.findIssuersForConnection({ connectionId });

    await this.deps.accounts.createAccount({
      userId,
      providerId: connectionId ?? provider,
      issuer: providerAccountIssuer({ connectionIssuer, provider }),
      accountId: subject,
    });
  }
}
