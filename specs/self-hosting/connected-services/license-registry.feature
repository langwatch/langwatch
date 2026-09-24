Feature: License registry
  Every license LangWatch issues is recorded on the LangWatch side, linked to the
  customer organization that bought it. The registry is what lets a hosted
  service be switched on for a customer, a license be revoked, and usage be
  billed to the right account, without changing the license format an install
  already holds.

  The registry does not store the token an install presents. It stores a hash
  of that token, so reading the registry table does not yield a working
  credential. The one license text it ever holds is a reissued license waiting
  to be delivered to its install, encrypted, and erased once delivered.

  As a LangWatch operator
  I want every issued license on record with its customer, entitlements and status
  So that hosted services, revocation and billing all work from one source

  Background:
    Given LangWatch Cloud with a license signing key configured as a server secret

  # ============================================================================
  # Every issue path writes the registry
  # ============================================================================

  @unit
  Scenario: A license issued from the backoffice is recorded
    When an operator issues a license for customer organization "ACME" with 50 seats
    Then the registry holds a row for that license linked to "ACME"
    And the row records the plan, the seats, the term and who issued it
    And the row is active with no instance bound

  @unit
  Scenario: A license bought through the payment link is recorded
    When a checkout for 10 seats completes
    Then the license that is emailed to the buyer is also in the registry
    And the row records that it was issued by the purchase flow
    And it is not linked to a customer organization, because a checkout names no customer on LangWatch Cloud

  @unit
  Scenario: A purchase still delivers its license when the registry cannot be written
    Given the registry cannot be written
    When a checkout completes
    Then the buyer still receives the license by email
    And the failure to record it is reported to LangWatch

  @unit
  Scenario: An unlinked license resolves to nothing
    Given a license in the registry that is not linked to a customer organization
    When it is presented as a credential
    Then it is refused as not registered

  @unit
  Scenario: An operator links a recorded license to a customer organization
    Given a license in the registry that is not linked to a customer organization
    When an operator links it to customer organization "ACME"
    Then the row is linked to "ACME"
    And "ACME" is marked as a self-hosted customer

  @unit
  Scenario: A license minted by the command line script is recorded
    When an operator mints a license with the generate-license script against the Cloud database
    Then the registry holds a row for that license

  @unit
  Scenario: The minted license and its registry row are written together
    Given the mint script applied a license to an organization
    When writing the license onto the organization fails
    Then the registry row is rolled back with it

  @unit
  Scenario: The registry stores a hash of the token, not the token
    When a license is issued and recorded
    Then the row holds a hash of the token the install will present
    And neither the license key nor the token itself appears in the row
    And the token cannot be computed from what the row holds

  @unit
  Scenario: A reissued license is held encrypted only until it is delivered
    Given a license that was reissued and is waiting for its install to pick it up
    Then the registry holds the new license encrypted
    When the install presents the new license for the first time
    Then the held copy is erased

  @unit
  Scenario: The backoffice organizations list does not carry license keys
    When an operator lists organizations in the backoffice
    Then no organization in the response includes its license key

  @unit
  Scenario: A license key is never kept in the audit trail
    When an organization activates a license, or an operator pastes one into the backoffice
    Then the audit entry for that action records that a license key was supplied
    And it does not hold the key

  @unit
  Scenario: A refused license command is still recorded
    When the registry refuses a command an operator sent
    Then the audit trail holds the attempt together with the refusal
    And the refusal still reaches the operator

  @unit
  Scenario: The same license always maps to the same registry row
    Given a license that was recorded when it was issued
    When the same license is presented with different line wrapping and trailing whitespace
    Then it resolves to the same registry row

  # ============================================================================
  # The signing key is a server secret
  # ============================================================================

  @unit
  Scenario: Issuing a license never asks the operator for the private key
    When an operator issues a license from the backoffice
    Then the license is signed with the key from the server secret
    And the request carries no private key

  @unit
  Scenario: Issuing is refused when no signing key is configured
    Given LangWatch Cloud with no license signing key configured
    When an operator issues a license
    Then the request is refused because license signing is not configured
    And nothing is written to the registry

  @unit
  Scenario: Only a LangWatch operator can issue or manage licenses
    Given a signed-in user who is an admin of their own organization but not a LangWatch operator
    When they try to issue, revoke or list licenses
    Then the request is refused

  # ============================================================================
  # Licenses issued before the registry existed
  # ============================================================================

  @unit
  Scenario: A license issued before the registry existed is registered by pasting it
    Given a license that LangWatch signed before the registry existed
    When an operator pastes it into the backoffice and links it to customer organization "ACME"
    Then the signature is verified
    And the registry holds a row for it linked to "ACME" with the seats and term read from the license

  @unit
  Scenario: A pasted license with a bad signature is refused
    Given a license whose payload was edited after signing
    When an operator pastes it into the backoffice
    Then the request is refused because the signature does not verify
    And nothing is written to the registry

  @unit
  Scenario: Registering the same license twice is refused
    Given a license that is already in the registry
    When an operator pastes it into the backoffice again
    Then the request is refused because the license is already registered
    And the existing row is unchanged

  # ============================================================================
  # Lifecycle
  # ============================================================================

  @unit
  Scenario: The same license written twice at once is still refused by name
    Given a license already recorded
    When a second write of the same license key gets past the duplicate check
    Then it is refused as already registered, not as a database error

  @unit
  Scenario: A license is written only once its customer is marked
    Given marking the customer as a self-hosted customer fails
    When an operator issues a license
    Then no row is written, so issuing again is not refused as a duplicate

  @unit
  Scenario: Revoking a license
    Given an active license in the registry
    When an operator revokes it with a reason
    Then the row is revoked and records who revoked it, when and why

  @unit
  Scenario: Reissuing a license
    Given an active license for "ACME" with 50 seats
    When an operator reissues it with 80 seats and a new term
    Then a new license is signed and recorded for "ACME"
    And the new row points at the license it replaces
    And the replaced license stays valid until the install has picked up the new one

  @integration
  Scenario: The signed license stays on screen while its row refreshes
    Given an operator reissued a license and the new one is shown to be copied
    When the registry refetches the license the drawer is open on
    Then the signed license is still shown

  @unit
  Scenario: A reissue names the constraint the table refused it on
    Given an active license in the registry
    When a reissue of it loses to a unique constraint
    Then a clash on the license it replaces is refused as already reissued
    And a clash on the license itself is refused as already registered

  @unit
  Scenario: A license past its term reads as expired
    Given a license in the registry whose term has ended
    When its status is read
    Then it reads as expired without anyone having edited the row

  @unit
  Scenario: Resetting the instance binding
    Given a license bound to an instance
    When an operator resets the instance binding
    Then the row has no instance bound

  @unit
  Scenario: Editing entitlements does not reissue the license
    Given an active license with no hosted services
    When an operator switches on the "instant_evals" service for it
    Then the row lists "instant_evals" as entitled
    And the license the install holds is unchanged

  @unit
  Scenario: Commercial terms are set on the registry row
    When an operator sets a seat rate of 600 USD per year, a prepaid commit of 1000 USD and on-demand overage up to 500 USD
    Then the row records the seat rate, the commit, that overage is enabled and its maximum

  @unit
  Scenario: Switching overage on suggests a quarter of the commit as the maximum
    Given a license form with a prepaid commit of 1000 USD and overage off
    When an operator switches on-demand overage on
    Then the maximum reads 250 USD, which the operator can edit
    And switching it off again sends no maximum
    And the registry holds no default maximum of its own

  @unit
  Scenario: An operator changes the seats of a running license
    Given an active license for 50 seats
    When an operator changes it to 58 seats
    Then a replacement is signed for 58 seats and the same term
    And it is held for delivery to the install over sync
    And billing is asked to invoice the 8 added seats

  @unit
  Scenario: Seats changed on a revoked license are refused
    Given a revoked license
    When an operator changes its seats
    Then the change is refused as not active
    And billing is asked for nothing

  @unit
  Scenario: An overage maximum without overage enabled is refused
    When an operator sets an overage maximum while on-demand overage is off
    Then the request is refused because the maximum only applies when overage is enabled

  # ============================================================================
  # The customer organization
  # ============================================================================

  @unit
  Scenario: A customer organization is marked as a self-hosted customer
    When an operator issues the first license for a new customer "ACME"
    Then an organization "ACME" exists on LangWatch Cloud marked as a self-hosted customer
    And the license is linked to it

  @integration
  Scenario: The backoffice lists licenses with their state
    Given licenses in the registry that are active, revoked and expired
    When an operator opens the licenses screen
    Then each license shows its customer, seats, term, status, entitled services and whether an instance is bound
    And a license that has synced shows when it last did and the seats it reported
