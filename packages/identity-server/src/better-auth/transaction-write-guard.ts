import { createLogger } from "@langwatch/observability";
import type { TransactionAdapter } from "./adapter-types";
import type { WriteOperation, WriteRouting } from "./write-routing";

const logger = createLogger("langwatch:better-auth:identity-adapter");

/**
 * Writes inside a transaction are routing-VALIDATED but never emit
 * ceremonies: a ClickHouse append does not belong inside a Postgres
 * transaction. A latched user's domain write in here would therefore be an
 * event gap — logged so the flow that introduces one is seen rather than
 * discovered later as a projection that disagrees. Today no
 * domain-significant flow is transactional.
 */
export class TransactionWriteGuard {
  constructor(private readonly routing: WriteRouting) {}

  /** The transaction adapter better-auth gets, with every write checked. */
  wrap(trx: TransactionAdapter): TransactionAdapter {
    return {
      ...trx,
      create: this.guard("create", trx.create.bind(trx)),
      update: this.guard("update", trx.update.bind(trx)),
      updateMany: this.guard("updateMany", trx.updateMany.bind(trx)),
      delete: this.guard("delete", trx.delete.bind(trx)),
      deleteMany: this.guard("deleteMany", trx.deleteMany.bind(trx)),
      consumeOne: this.guard("consumeOne", trx.consumeOne.bind(trx)),
      incrementOne: this.guard("incrementOne", trx.incrementOne.bind(trx)),
    };
  }

  // `Fn` is constrained on `never` rather than `{ model: string }` because
  // the adapter's write methods are generic over their payload, and a
  // generic function's parameter is not assignable FROM the bare
  // `{ model }` shape.
  private guard<Fn extends (args: never) => unknown>(
    operation: WriteOperation,
    run: Fn,
  ): Fn {
    return ((args: { model: string }) => {
      const route = this.routing.routeOf({ model: args.model, operation });
      if (route === "domain") {
        logger.warn(
          { model: args.model, operation },
          "domain-significant better-auth write inside a transaction: no ceremony runs here; the backfill adopts the row",
        );
      }
      return run(args as never);
    }) as unknown as Fn;
  }
}
