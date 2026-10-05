import type { AuthzRepositories } from "../authz.repositories.ts";
import { AuthzMemoryStore } from "./authz-memory.store.ts";
import { MemoryAuthzAdmissionRepository } from "./memory.authz-admission.repository.ts";
import { MemoryAuthzCutoverRepository } from "./memory.authz-cutover.repository.ts";
import { MemoryAuthzEpochRepository } from "./memory.authz-epoch.repository.ts";
import { MemoryAuthzManagedGrantRepository } from "./memory.authz-managed-grant.repository.ts";
import { MemoryAuthzSessionVersionRepository } from "./memory.authz-session-version.repository.ts";
import { MemoryAuthzUserStandingRepository } from "./memory.authz-user-standing.repository.ts";

export class MemoryAuthzRepositories {
  static readonly requires = [] as const;

  static create(): AuthzRepositories {
    const memory = AuthzMemoryStore.create();

    return {
      bindings: MemoryAuthzManagedGrantRepository.create({ memory }),
      cutover: MemoryAuthzCutoverRepository.create({ memory }),
      admissions: MemoryAuthzAdmissionRepository.create({ memory }),
      userStandings: MemoryAuthzUserStandingRepository.create({ memory }),
      epoch: MemoryAuthzEpochRepository.create({ memory }),
      sessionVersions: MemoryAuthzSessionVersionRepository.create({ memory }),
    };
  }
}
