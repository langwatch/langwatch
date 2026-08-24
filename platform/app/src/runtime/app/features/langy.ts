import type { LangyService } from "@langwatch/langy-contract";
import {
  PostgresLangyAdapter,
  type LangyEventingCapabilities,
  type LangyServiceCompositionOptions,
} from "@langwatch/langy-server";
import type { PrismaClient } from "~/generated/prisma/client";

/** Composes one process-owned Langy service while keeping persistence private. */
export class AppLangyRuntime {
  private readonly adapter: PostgresLangyAdapter;

  private constructor(database: PrismaClient) {
    this.adapter = PostgresLangyAdapter.create({ database });
  }

  static create(options: { database: PrismaClient }): AppLangyRuntime {
    return new AppLangyRuntime(options.database);
  }

  eventing(): LangyEventingCapabilities {
    return this.adapter.eventing();
  }

  build(options: LangyServiceCompositionOptions): LangyService {
    return this.adapter.build(options);
  }
}
