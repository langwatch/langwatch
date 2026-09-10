import type { AuthzRepositories } from "../authz.repositories.ts";
import { AuthzMemoryStore } from "./authz-memory.store.ts";
import { MemoryAuthzBindingRepository } from "./memory.authz-binding.repository.ts";
import { MemoryAuthzCutoverRepository } from "./memory.authz-cutover.repository.ts";

export class MemoryAuthzRepositories {
  static readonly requires = [] as const;

  static create(): AuthzRepositories {
    const memory = AuthzMemoryStore.create();

    return {
      bindings: MemoryAuthzBindingRepository.create({ memory }),
      cutover: MemoryAuthzCutoverRepository.create({ memory }),
    };
  }
}
