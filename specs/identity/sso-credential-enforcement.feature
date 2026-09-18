Feature: Recovery credentials respect the organization's SSO route
  A password proves the user before a live recovery grant can open the local
  door. The governing connection is chosen from the proved sign-in address.
  Completing a second factor rechecks the grant for that same address.

  @integration @regression
  Scenario: SSO governed passwords require a recovery grant in every deployment mode
    Given an active organization connection governs the user's sign-in address
    And the user has no live recovery grant
    When they submit their correct password in email or mixed deployment mode
    Then sign-in fails with EMAIL_PASSWORD_DISABLED and creates no session

  @integration @regression
  Scenario: A current recovery holder can sign in with their verified password
    Given the authenticated user has a live grant for the governing organization
    When they submit a wrong password
    Then no recovery grant is consulted and no session is opened
    When they submit their correct password
    Then they can sign in in email or mixed deployment mode

  @integration @regression
  Scenario: A recovery grant cannot start a password reset for an SSO governed address
    Given an active organization connection governs the submitted address
    When a recovery holder requests a password reset
    Then the request fails with EMAIL_PASSWORD_DISABLED and sends no reset token

  @integration @regression
  Scenario: Recovery sign-in still requires the enrolled second factor
    Given a recovery holder has enrolled a second factor
    When they submit their correct password
    Then they have a pending second factor and no usable session
    When they prove their TOTP or backup code
    Then the live grant is checked again and a session is opened

  @integration @regression
  Scenario: A recovery grant must still be live when the second factor completes
    Given a recovery holder has proved their password and is awaiting a second factor
    When their grant expires or is revoked before they prove the second factor
    Then sign-in fails with EMAIL_PASSWORD_DISABLED and creates no session

  @integration @regression
  Scenario: Recovery checks retain the proved alias rather than the canonical email
    Given a user's verified company alias differs from their canonical email
    When the user proves their password with that alias and completes a second factor
    Then both grant checks use the authenticated user and the company alias
    And a submitted email on the second-factor request cannot replace that alias

  @integration @regression
  Scenario: A second factor cannot mint a session without its own unexpired credential ceremony
    Given a recovery holder has proved their password and is awaiting a second factor
    When their credential ceremony is missing, expired, malformed, or belongs to another user or challenge
    Then proving the second factor fails with EMAIL_PASSWORD_DISABLED and creates no session

  @unit @regression
  Scenario: Recovery permission belongs to the authenticated user and governing organization
    Given an active company connection governs the submitted verified address
    When the authenticated user has no grant or only a grant for another user or organization
    Then password sign-in is refused
    When that user holds a live grant for the governing organization
    Then password sign-in is allowed

  @unit @regression
  Scenario: An ungoverned personal address keeps its existing local sign-in route
    Given an organization governs a user's company alias but not their personal address
    When the user signs in with their personal address
    Then the company route does not require a recovery grant for that address

  @unit @regression
  Scenario: Recovery login ends at grant expiry or revocation without waiting for a worker
    Given the authenticated user holds a live grant for their governing organization
    When that grant expires or is revoked
    Then password sign-in is refused immediately

  @unit @regression
  Scenario: A holder's role change does not revoke an existing recovery grant
    Given a recovery grant was issued to an eligible administrator
    When that holder stops being an administrator while the grant remains live
    Then the grant still permits password sign-in

  @integration @regression
  Scenario: An existing session cannot complete another pending recovery sign-in
    Given a recovery holder is awaiting a second factor and their grant is revoked
    And the browser also presents a valid existing session for that holder or another user
    When the existing session proves its own second factor
    Then it keeps the same user and creates no new session
    When the pending recovery sign-in completes without that existing session
    Then it fails with EMAIL_PASSWORD_DISABLED and creates no session

  @unit @regression
  Scenario: Passkey sessions enforce recovery permission for the authenticated address
    Given a passkey proves a user whose primary address is governed by SSO
    When the user has no live recovery grant
    Then the session guard refuses both passkey authentication and session-creating registration
    And a submitted address cannot replace the authenticated user's primary address

  @unit @regression
  Scenario: Instance federation leaves credential permission to the deployment policy
    Given routing selects an instance provider without an organization connection
    When the credential session policy checks that decision
    Then it requires no organization recovery grant
    And deployments with local passwords disabled still refuse password requests

  @unit @regression
  Scenario: Unnamed SSO requests cannot trust another tenant's origin
    Given organizations register different issuer origins
    When an SSO request omits a connection and supplies a redirect or Origin
    Then only the issuer resolved from its verified domain may be trusted
    And an unresolved domain adds no issuer origins

  @integration
  Scenario: An upgrade restores verified domain routes and tenant-owned directory identities
    Given an existing active SSO connection with verified domains and SCIM identities
    When the ownership backfill runs
    Then its domains route to the existing connection
    And its SCIM identities belong to the connection's organization
    And conflicting domain owners or orphaned identities refuse the upgrade
