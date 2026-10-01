Feature: SCIM provisioning keeps directory and access in sync

  A directory's PATCH, group membership and deprovisioning writes must
  reach the same conclusion an identity provider expects: deactivating a
  user removes their access, and every write stays scoped to the
  organization its token belongs to.

  # scim-user-patch.service.ts, scim-group-membership.service.ts,
  # scim-user-profile.service.ts, scim-directory.service.ts,
  # scim-directory-identity.service.ts, scim-grants.service.ts,
  # scim-webhook-signature.rules.ts, identity/scim-sync-guards.service.ts

  @unit @unimplemented
  Scenario: Deactivating a user through SCIM revokes their access
    Given an active SCIM-provisioned user
    When the directory patches them to inactive
    Then they can no longer sign in and their grants are removed

  @unit @unimplemented
  Scenario: A PATCH whose attribute casing differs from the schema still applies
    Given a directory that sends "Active" rather than "active"
    When the patch is applied
    Then the user's active state changes as the directory intended

  @unit @unimplemented
  Scenario: Removing a user from a SCIM group removes the access that group carried
    Given a user whose only project access comes from a SCIM group
    When the directory removes them from that group
    Then they lose that project access

  @unit @unimplemented
  Scenario: A SCIM webhook with an invalid signature is refused
    Given a webhook body whose signature does not verify
    When it is received
    Then it is refused and no directory change is applied

  @unit @unimplemented
  Scenario: A SCIM write for a directory not connected to the organization is refused
    Given a SCIM token scoped to one organization
    When it writes a user into another
    Then the write is refused

  @unit
  Scenario: A group PATCH with case-insensitive add/remove operations changes only the membership delta
    Given a group PATCH whose operation names differ in case from the schema
    When the patch is applied
    Then only the intended membership delta changes
