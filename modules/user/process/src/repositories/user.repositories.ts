import type { UserCredentialRepository } from "./user-signin-credential.repository.ts";
import type { UserRepository } from "./user.repository.ts";

export interface UserRepositories {
  readonly users: UserRepository;
  readonly credentials: UserCredentialRepository;
}
