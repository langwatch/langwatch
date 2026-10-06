import { HandledError } from "@langwatch/handled-error";
import type { BetterAuthOptions } from "better-auth";
import type {
  AdapterFactory,
  AdapterFactoryConfig,
  AdapterFactoryCustomizeAdapterCreator,
  CustomAdapter,
  DBAdapter,
} from "better-auth/adapters";
import { createAdapterFactory } from "better-auth/adapters";
import { APIError } from "better-auth/api";

import { type AdapterNaming, httpStatusFor } from "../rules/better-auth-storage-rows.rules.ts";

export interface IdentityStorageAdapterDeps {
  /**
   * better-auth's own published storage engine, built (`prismaAdapter(...)`,
   * `memoryAdapter(...)`) but not yet bound to options. The legacy branch delegates to it
   * verbatim, so an unlatched user's behavior is byte-for-byte what the stock adapter did.
   */
  legacyEngine: (options: BetterAuthOptions) => DBAdapter;
  /** The routed adapter, composed in app/ once per bound engine and naming (Q223 (a)). */
  routing: (args: { legacy: DBAdapter; naming: AdapterNaming }) => CustomAdapter;
}

type PasskeyRemovalOutcome = "deleted" | "not_found" | "would_strand_user";

/**
 * The atomic persistence boundary behind better-auth's one-passkey delete.
 * Decision and deletion share one serializable transaction: two removals
 * reading the same stale set could both proceed and lock the user out.
 */
export interface PasskeyRemoval {
  deleteIfAnotherWayInRemains(args: { passkeyId: string }): Promise<PasskeyRemovalOutcome>;
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

  /** The better-auth adapter factory this branch installs. */
  factory(): AdapterFactory<BetterAuthOptions> {
    return (options) =>
      createAdapterFactory({
        config: identityAdapterConfig,
        adapter: this.customAdapter(this.deps.legacyEngine(options)),
      })(options);
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
