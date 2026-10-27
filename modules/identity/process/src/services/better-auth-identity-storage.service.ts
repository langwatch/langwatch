import { HandledError } from "@langwatch/handled-error";
import type { BetterAuthOptions } from "better-auth";
import type {
  AdapterFactory,
  AdapterFactoryConfig,
  AdapterFactoryCustomizeAdapterCreator,
  CustomAdapter,
  DBAdapter,
  DBTransactionAdapter,
} from "better-auth/adapters";
import { createAdapterFactory } from "better-auth/adapters";
import { APIError } from "better-auth/api";

import { type AdapterNaming, httpStatusFor } from "../rules/better-auth-storage-rows.rules.ts";

type LegacyEngine = (options: BetterAuthOptions) => DBAdapter;

interface IdentityStorageAdapterDeps {
  /**
   * better-auth's own published storage engine, built (`prismaAdapter(...)`,
   * `memoryAdapter(...)`) but not yet bound to options. The legacy branch delegates to it
   * verbatim, so an unlatched user's behavior is byte-for-byte what the stock adapter did.
   */
  legacyEngine: LegacyEngine;
  /**
   * One real Postgres transaction with the legacy engine rebound to it. Required: better-auth's
   * SSO plugin runs `resolveUser` only when `transaction` is a function, and its `SsoProvider`
   * row lock holds only inside one. The identity branch's event store is not spanned.
   */
  postgresTransaction: <R>(work: (legacyEngine: LegacyEngine) => Promise<R>) => Promise<R>;
  /** The routed adapter, composed in app/ once per bound engine and naming (Q223 (a)). */
  routing: (args: { legacy: DBAdapter; naming: AdapterNaming }) => CustomAdapter;
}

/**
 * better-auth's one `database:` entry (ADR-116 §1): an identity-owned
 */
export class BetterAuthIdentityStorageService {
  static create(deps: IdentityStorageAdapterDeps): BetterAuthIdentityStorageService {
    return new BetterAuthIdentityStorageService(deps);
  }

  private constructor(private readonly deps: IdentityStorageAdapterDeps) {}

  private customAdapter(legacy: DBAdapter): AdapterFactoryCustomizeAdapterCreator {
    return (naming) => surfacingHandledRefusals(this.deps.routing({ legacy, naming }));
  }

  /** The better-auth adapter factory; a transaction rebuilds it over the rebound engine. */
  factory(): AdapterFactory<BetterAuthOptions> {
    return (options) => {
      const over = (legacyEngine: LegacyEngine, config: AdapterFactoryConfig): DBAdapter =>
        createAdapterFactory({ config, adapter: this.customAdapter(legacyEngine(options)) })(
          options,
        );
      return over(this.deps.legacyEngine, {
        ...identityAdapterConfig,
        transaction: <R>(
          callback: (trx: DBTransactionAdapter<BetterAuthOptions>) => Promise<R>,
        ): Promise<R> =>
          this.deps.postgresTransaction((legacyEngine) =>
            callback(over(legacyEngine, identityAdapterConfig)),
          ),
      });
    };
  }
}

/**
 * Value coercion is deliberately absent: every `supports*` flag is on, so this factory maps
 * NAMES and leaves shapes alone.
 */
const identityAdapterConfig: AdapterFactoryConfig = {
  adapterId: "langwatch-identity",
  adapterName: "LangWatch Identity Adapter",
  supportsJSON: true,
  supportsDates: true,
  supportsBooleans: true,
  supportsArrays: true,
  supportsNumericIds: true,
  supportsUUIDs: true,
};

/** Every method wrapped once; a new required adapter method fails to compile here. */
function surfacingHandledRefusals(adapter: CustomAdapter): CustomAdapter {
  return {
    create: (input) => surfaceHandledRefusals(() => adapter.create(input)),
    update: (input) => surfaceHandledRefusals(() => adapter.update(input)),
    updateMany: (input) => surfaceHandledRefusals(() => adapter.updateMany(input)),
    findOne: (input) => surfaceHandledRefusals(() => adapter.findOne(input)),
    findMany: (input) => surfaceHandledRefusals(() => adapter.findMany(input)),
    delete: (input) => surfaceHandledRefusals(() => adapter.delete(input)),
    deleteMany: (input) => surfaceHandledRefusals(() => adapter.deleteMany(input)),
    consumeOne: (input) => surfaceHandledRefusals(() => adapter.consumeOne(input)),
    incrementOne: (input) => surfaceHandledRefusals(() => adapter.incrementOne(input)),
    count: (input) => surfaceHandledRefusals(() => adapter.count(input)),
  };
}

/**
 * The adapter boundary's translation (ADR-116 §6): a `HandledError` becomes
 */
async function surfaceHandledRefusals<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!HandledError.isHandled(error)) throw error;
    throw new APIError(
      httpStatusFor(error.httpStatus),
      { code: error.code, message: error.message, cause: error },
      undefined,
      error.httpStatus,
    );
  }
}
