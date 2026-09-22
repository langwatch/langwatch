import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { SsoEngineProviderRow } from "../../rules/sso-engine-provider.rules.ts";
import { SsoEngineProviderRepository } from "../sso-engine-provider.repository.ts";

/** The one model the engine's provider row reads and writes, and no other. */
export type PrismaSsoEngineProviderDatabase = Pick<PrismaClient, "ssoProvider">;

/** The engine's provider rows, as the connection fold keeps them (D09). */
export class PrismaSsoEngineProviderRepository extends SsoEngineProviderRepository {
  static create(database: PrismaSsoEngineProviderDatabase): PrismaSsoEngineProviderRepository {
    return new PrismaSsoEngineProviderRepository(database);
  }

  private constructor(private readonly database: PrismaSsoEngineProviderDatabase) {
    super();
  }

  async put(row: SsoEngineProviderRow): Promise<void> {
    const columns = {
      issuer: row.issuer,
      oidcConfig: row.oidcConfig,
      samlConfig: row.samlConfig,
      providerId: row.providerId,
      organizationId: row.organizationId,
      domain: row.domain,
    };
    await this.database.ssoProvider.upsert({
      where: { id: row.id },
      create: { id: row.id, ...columns },
      update: columns,
    });
  }

  async remove({ connectionId }: { connectionId: string }): Promise<void> {
    await this.database.ssoProvider.deleteMany({ where: { id: connectionId } });
  }
}
