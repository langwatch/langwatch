import type { UserRepository } from "./user.repository.ts";
import type { UserCredentialRepository } from "./user-signin-credential.repository.ts";

export interface UserRepositories {
  readonly users: UserRepository;
  readonly credentials: UserCredentialRepository;
}
