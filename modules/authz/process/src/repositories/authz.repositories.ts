import type { AuthzAdmissionRepository } from "./authz-admission.repository.ts";
import type { AuthzBindingRepository } from "./authz-binding.repository.ts";
import type { AuthzCutoverRepository } from "./authz-cutover.repository.ts";

/**
 * The rows the authz module selects at boot. The epoch is deliberately
 * absent: it lives in Redis, handed to the module as a member rather than
 * a persistence selection, so the app builds that row from what it is given.
 */
export interface AuthzRepositories {
  readonly bindings: AuthzBindingRepository;
  readonly cutover: AuthzCutoverRepository;
  readonly admissions: AuthzAdmissionRepository;
}
