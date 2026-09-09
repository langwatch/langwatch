import type { RoleRepository } from "./role.repository.ts";

export interface RoleRepositories {
  readonly roles: RoleRepository;
}
