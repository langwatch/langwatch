import type { AppFunctionStoreProbe } from "../../rules/langwatch-ql-app-function-store.rules.ts";
import { LangWatchQLAppFunctionStoreRepository } from "../langwatch-ql-app-function-store.repository.ts";

/** The memory tier has no ClickHouse server to probe: it answers nothing, as a silent one does. */
export class MemoryLangWatchQLAppFunctionStoreRepository extends LangWatchQLAppFunctionStoreRepository {
  static create(): MemoryLangWatchQLAppFunctionStoreRepository {
    return new MemoryLangWatchQLAppFunctionStoreRepository();
  }

  private constructor() {
    super();
  }

  findProbe(): Promise<AppFunctionStoreProbe[]> {
    return Promise.resolve([]);
  }
}
