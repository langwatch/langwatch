import type { AuthzBindingRepository } from "./authz-binding.repository.ts";
import type { AuthzCutoverRepository } from "./authz-cutover.repository.ts";

/**
 * The rows the authz module selects at boot.
 *
 * The epoch is deliberately absent: it lives in Redis, which a process hands
 * this module as infrastructure rather than as its persistence selection, so
 * the app builds that one row from what it is given.
 */
export interface AuthzRepositories {
  readonly bindings: AuthzBindingRepository;
  readonly cutover: AuthzCutoverRepository;
}
