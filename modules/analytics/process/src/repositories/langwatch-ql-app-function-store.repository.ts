import type { AppFunctionStoreProbe } from "../features/app-functions/rules/langwatch-ql-app-function-store.rules.ts";

/** Where this server would keep the LangWatchQL app functions. */
export abstract class LangWatchQLAppFunctionStoreRepository {
  /** Empty where the server did not answer the replica layout or the Keeper store read. */
  abstract findProbe(): Promise<AppFunctionStoreProbe[]>;
}
