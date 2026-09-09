/**
 * One `AuthzGrantsService` double for the package, replacing seven copies.
 *
 * Every copy declared `attachBindings` and `revokeBindings` as
 * `vi.fn(async () => [])`, which is not what either returns: attaching answers
 * `{ attached, duplicates }` and revoking answers nothing at all. The suites
 * pass either way — nothing under test reads those answers today — so the
 * drift showed up only as 47 type errors in a package CI never typechecked.
 *
 * A fake that lies about its contract is worse than no fake: the day a SCIM
 * path starts reading `.attached` to report what it provisioned, seven tests
 * would go on passing against `[]`.
 */
import {
  type AuthzAttachBindingsOutput,
  AuthzGrantsService,
  type AuthzOffboardOutput,
} from "@langwatch/authz-contract";
import { vi } from "vitest";

export class GrantsFake extends AuthzGrantsService {
  readonly attach = vi.fn();
  readonly update = vi.fn();
  readonly revoke = vi.fn();
  readonly replace = vi.fn();
  /**
   * Answers the real `AuthzOffboardOutput`: `ScimDeprovisionService` reads
   * `.needsHumanDecision` straight off it, so a bare `vi.fn()` here is not a
   * quiet inaccuracy — it is a `TypeError` in the service under test.
   */
  readonly offboard = vi.fn(async (): Promise<AuthzOffboardOutput> => ({
    removed: {
      bindings: 0,
      groupMemberships: 0,
      legacyTeamMemberships: 0,
      pendingInvites: 0,
      organizationMembership: true,
    },
    needsHumanDecision: { ownedApiKeys: [], personalTeams: [] },
  }));
  readonly attachBindings = vi.fn(async (): Promise<AuthzAttachBindingsOutput> => ({
    attached: [],
    duplicates: [],
  }));
  readonly attachResourceGrant = vi.fn();
  readonly revokeResourceGrants = vi.fn();
  readonly changeBindingRole = vi.fn();
  readonly revokeBindings = vi.fn(async (): Promise<void> => void 0);
  readonly revokeBindingsWhere = vi.fn();
  readonly offboardMember = vi.fn();
  readonly defineRole = vi.fn();
  readonly deleteRole = vi.fn();
  readonly createBinding = vi.fn();
  readonly updateBinding = vi.fn();
  readonly deleteBinding = vi.fn();
  readonly applyMemberBindings = vi.fn();
  readonly invalidateOrganization = vi.fn();
}
