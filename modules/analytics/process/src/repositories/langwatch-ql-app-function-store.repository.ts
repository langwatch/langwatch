import type { AppFunctionStoreProbe } from "../rules/langwatch-ql-app-function-store.rules.ts";

/** Where this server would keep the LangWatchQL app functions. */
export abstract class LangWatchQLAppFunctionStoreRepository {
  /** Empty where the server did not answer the two settings the probe reads. */
  abstract findProbe(): Promise<AppFunctionStoreProbe[]>;
}
