import {
  sealedProviderConfigCipher,
  type SsoProviderConfigCipher,
} from "@langwatch/identity-contract";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { BetterAuthOptions } from "better-auth/types";

import { openingSsoProviderConfigs } from "../../rules/sso-provider-config.rules.ts";
import { BetterAuthStorageRepository } from "../better-auth-storage.repository.ts";

/** Better Auth's storage engine: the stock Prisma adapter over the module's
 *  own client, with the engine's sealed dialing documents opened on the way
 *  out — this is the one seam that dials with them (D09). */
export class PrismaBetterAuthStorageRepository extends BetterAuthStorageRepository {
  static create({
    prisma,
    encryption,
  }: {
    prisma: ProcessMembers["prisma"];
    encryption: ProcessMembers["encryption"];
  }): PrismaBetterAuthStorageRepository {
    return new PrismaBetterAuthStorageRepository(prisma, sealedProviderConfigCipher(encryption));
  }

  private constructor(
    private readonly database: ProcessMembers["prisma"],
    private readonly providerConfig: SsoProviderConfigCipher,
  ) {
    super();
  }

  adapter(): unknown {
    // The SSO plugin refuses every callback when a `resolveUser` is set and the
    // adapter has no native transactions.
    const engine = prismaAdapter(this.database, { provider: "postgresql", transaction: true });
    const cipher = this.providerConfig;
    return (options: BetterAuthOptions) =>
      openingSsoProviderConfigs({ adapter: engine(options), cipher });
  }
}
