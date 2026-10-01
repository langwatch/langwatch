import type { SsoEngineProviderRow } from "../../rules/sso-engine-provider.rules.ts";
import { SsoEngineProviderRepository } from "../sso-engine-provider.repository.ts";

/** The columns the engine's row is written from, minus its own key. */
type EngineProviderColumns = Omit<SsoEngineProviderRow, "id">;

/** The one delegate this repository reads and writes, and no other. */
export type PrismaSsoEngineProviderDatabase = {
  ssoProvider: {
    upsert(args: {
      where: { id: string };
      create: EngineProviderColumns & { id: string };
      update: EngineProviderColumns;
    }): Promise<unknown>;
    findUnique(args: {
      where: { id: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    deleteMany(args: { where: { id: string } }): Promise<{ count: number }>;
  };
};

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

  async findRegisteredProvider({ connectionId }: { connectionId: string }): Promise<boolean> {
    const row = await this.database.ssoProvider.findUnique({
      where: { id: connectionId },
      select: { id: true },
    });

    return row !== null;
  }

  async remove({ connectionId }: { connectionId: string }): Promise<void> {
    await this.database.ssoProvider.deleteMany({ where: { id: connectionId } });
  }
}
