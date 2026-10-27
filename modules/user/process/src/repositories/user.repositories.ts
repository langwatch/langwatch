import type { GdprUserDataEraseRepository } from "./user-data-erase.repository.ts";
import type { UserOrganizationDirectoryRepository } from "./user-organization-directory.repository.ts";
import type { UserRateLimitRepository } from "./user-rate-limit.repository.ts";
import type { UserCredentialRepository } from "./user-signin-credential.repository.ts";
import type { UserRepository } from "./user.repository.ts";

export interface UserRepositories {
  readonly users: UserRepository;
  readonly credentials: UserCredentialRepository;
  readonly rateLimits: UserRateLimitRepository;
  readonly organizationDirectory: UserOrganizationDirectoryRepository;
  readonly dataErase: GdprUserDataEraseRepository;
}
