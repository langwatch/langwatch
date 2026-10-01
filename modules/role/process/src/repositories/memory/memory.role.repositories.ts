import type { RoleRepositories } from "../role.repositories.ts";
import { MemoryRoleRepository } from "./memory.role.repository.ts";

export class MemoryRoleRepositories {
  static readonly requires = [] as const;

  static create(): RoleRepositories {
    return { roles: MemoryRoleRepository.create() };
  }
}
