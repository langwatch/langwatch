import { createLogger } from "@langwatch/observability";
import type { TransactionAdapter } from "./identityAdapterContext";
import { routeWrite, type WriteOperation } from "./identityRouting";

const logger = createLogger("langwatch:better-auth:identity-adapter");

/**
 * Writes inside a transaction are routing-validated but never emit
 * ceremonies; see the module doc in identityDatabase.ts. `latched` users'
 * domain writes in here
 * would be an event gap — logged so the flow that introduces one is seen.
 */
export function guardTransaction(trx: TransactionAdapter): TransactionAdapter {
  // `Fn` is constrained on `never` rather than `{ model: string }` because the
  // adapter's write methods are generic over their payload, and a generic
  // function's parameter is not assignable FROM the bare `{ model }` shape.
  const guardedWrite = <Fn extends (args: never) => unknown>(
    operation: WriteOperation,
    run: Fn,
  ): Fn =>
    ((args: { model: string }) => {
      const route = routeWrite(args.model, operation);
      if (route === "domain") {
        logger.warn(
          { model: args.model, operation },
          "domain-significant better-auth write inside a transaction: no ceremony runs here; the backfill adopts the row",
        );
      }
      return run(args as never);
    }) as unknown as Fn;

  return {
    ...trx,
    create: guardedWrite("create", trx.create.bind(trx)),
    update: guardedWrite("update", trx.update.bind(trx)),
    updateMany: guardedWrite("updateMany", trx.updateMany.bind(trx)),
    delete: guardedWrite("delete", trx.delete.bind(trx)),
    deleteMany: guardedWrite("deleteMany", trx.deleteMany.bind(trx)),
    consumeOne: guardedWrite("consumeOne", trx.consumeOne.bind(trx)),
    incrementOne: guardedWrite("incrementOne", trx.incrementOne.bind(trx)),
  };
}
