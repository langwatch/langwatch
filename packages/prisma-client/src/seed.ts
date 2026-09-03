import type { PrismaConnection } from "./connection";
import type { PrismaClient } from "./generated/client";

/** Product-owned seed behavior; this package owns only its execution mechanics. */
export abstract class PrismaSeed {
  abstract run(client: PrismaClient): Promise<void>;
}

export class PrismaSeedService {
  private constructor() {}

  static create(): PrismaSeedService {
    return new PrismaSeedService();
  }

  run(input: { connection: PrismaConnection; seed: PrismaSeed }): Promise<void> {
    return input.seed.run(input.connection.client);
  }
}
