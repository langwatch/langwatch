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
  Scenario: A license issued from the admin console is recorded
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
  Scenario: A minted license whose organization write fails leaves no registry row
    Given the mint script recorded a license in the registry for an organization
    When writing the license onto the organization fails
    Then the registry row is deleted again
    And the mint fails

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
  Scenario: The license list filters by status and by who the license is for
    Given an active customer license, a revoked customer license and an active license issued to a langwatch.ai address
    When an operator lists active customer licenses
    Then only the active customer license is listed
    When the operator lists revoked or expired licenses of any audience
    Then only the revoked license is listed
    When the operator lists internal licenses of any status
    Then only the langwatch.ai license is listed
    When the operator asks for every license
    Then all three are listed

  @unit
  Scenario: Each license filter choice says how many licenses it would list
    Given an active customer license, a revoked customer license and an active license issued to a langwatch.ai address
    When an operator lists active customer licenses
    Then the list says 1 is active and 1 is revoked or expired, among customer licenses
    And it says 1 is a customer license and 1 is internal, among active licenses

  @integration
  Scenario: The console's license filters say what they hide
    Given internal licenses that are all revoked or expired
    When an operator opens the licenses page
    Then it lists active customer licenses, with how many licenses each filter choice would list
    And the empty list says the filters hide every license, not that the registry is empty
    When the operator clears the filters
    Then every license is listed
    When the operator searches for something no license matches
    Then the empty list says the search matched nothing
    And while the next answer loads, the list says nothing about being empty

  @unit
  Scenario: The instance admin organizations list does not carry license keys
    When an operator lists organizations in the instance admin
    Then no organization in the response includes its license key

  @unit
  Scenario: A license key is never kept in the audit trail
    When an organization activates a license, or an operator pastes one into the instance admin
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
    When an operator issues a license from the instance admin
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
    When an operator pastes it into the instance admin and links it to customer organization "ACME"
    Then the signature is verified
    And the registry holds a row for it linked to "ACME" with the seats and term read from the license

  @unit
  Scenario: A pasted license with a bad signature is refused
    Given a license whose payload was edited after signing
    When an operator pastes it into the instance admin
    Then the request is refused because the signature does not verify
    And nothing is written to the registry

  @unit
  Scenario: Registering the same license twice is refused
    Given a license that is already in the registry
    When an operator pastes it into the instance admin again
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
  Scenario: Retiring an unused key is refused once an install has bound the license
    Given a license an install bound after the operator opened the drawer
    When the drawer retires it as a key no install used
    Then the registry refuses with license_in_use
    And the license and its managed key stay live

  @unit
  Scenario: A bind and an unused-key revoke racing on one license cannot both win
    Given a license no install has used
    When an install binds it after the drawer's revoke read the row, before the revoke writes
    Then the revoke is refused with license_in_use and the license stays bound and live
    And a bind that arrives after an unused-key revoke is refused

  @integration
  Scenario: The registry revokes an unbound license and refuses to bind a revoked one in single writes
    Given an unbound license and a bound one
    When the unbound one is revoked as unused and an install then tries to bind it
    Then the revoke wins, the bind is refused, and revoking the bound one as unused is refused

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
  Scenario: After a binding reset the drawer treats the chain as unused
    Given a chain whose live license was unbound by a reset
    And a superseded license of it that still names the old install
    When the drawer reads the chain
    Then it reads as unbound, so a new key is shown to send and the unused one is retired

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
    And the replacement records that it raised the seats from 50, in the same write
    And billing reads that seat change from licensing to invoice the 8 added seats
    And the operator is told billing invoices the added seats and the Billing section shows the outcome

  @unit
  Scenario: Seats raised on a license linked to no customer leave billing nothing to invoice
    Given an active license linked to no customer organization
    When an operator raises its seats
    Then a replacement is signed for the new seats
    And no seat change is recorded for billing
    And the operator is told nothing is invoiced

  @unit
  Scenario: Seats changed on a revoked license are refused
    Given a revoked license
    When an operator changes its seats
    Then the change is refused as not active
    And no seat change is recorded for billing

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
  Scenario: A customer organization gets the same kind of id as any other organization
    When an operator issues the first license for a new customer "ACME"
    Then the organization created for "ACME" has an id that starts with "organization_"

  @integration
  Scenario: The admin console lists licenses with their state
    Given licenses in the registry that are active, revoked and expired
    When an operator opens the licenses screen
    Then each license shows its customer, seats, term, status, entitled services and whether an instance is bound
    And a license that has synced shows when it last did and the seats it reported

  @unit
  Scenario: The licenses list shows one row per reissue chain, the newest
    Given a license that was extended, with the replacement waiting for the install
    When an operator opens the licenses screen
    Then the list shows one row for that customer, the replacement
    And the status and audience counts count it once

  @integration
  Scenario: The registry lists and counts a reissue chain once
    Given a license replaced by an unrevoked license, and another whose replacement was revoked
    When the registry lists the licenses that are newest in their chain
    Then the replaced license is left out and the one with the revoked replacement stays

  # ============================================================================
  # The license drawer: what the install gets, and when it gets it
  # ============================================================================
  # A license is a signed token with its term inside, so a new end date is a
  # replacement (a reissue) delivered over sync, never an edit of the row.

  @unit
  Scenario: The chain of a license lists what it replaced and what replaces it
    Given a license for "ACME" that was reissued twice
    When an operator reads the chain of any license in it
    Then every license in the chain is listed, the newest first

  @unit
  Scenario: The seats a customer uses are read from the license that last synced
    Given a bound license that reported 8 seats in use
    And a replacement for it that the install has not picked up yet
    When billing reads the seats of that customer
    Then it reads the replacement's seats as licensed and 8 as in use

  @integration
  Scenario: The drawer opens on the install that holds the license
    Given a license bound to install "acme-prod" that last synced this morning
    When an operator opens it in the drawer
    Then the drawer names the install, when it last synced, its version, the seats in use and when the next daily sync is due

  @integration
  Scenario: Extending a trial signs a replacement the install picks up on its next sync
    Given a bound license for "ACME" ending Dec 1 that no billing account was opened for
    When an operator picks "+2 weeks" under Extend term and saves
    Then a replacement is signed ending Dec 15 with the same seats
    And no license key is shown, only a way to show it if the install cannot sync
    And the drawer says the extension waits for the install's next sync

  @integration
  Scenario: A replacement waiting for delivery shows on the license it replaces
    Given a bound license with a replacement the install has not picked up yet
    When an operator opens the license in use
    Then the drawer shows the term moving from the old end date to the new one, waiting for sync
    And says how to get it now with Refresh license on the install

  @integration
  Scenario: A Developer seat change waiting for delivery shows as waiting for sync
    Given a bound license with no Developer seats
    And a replacement with 5 Developer seats the install has not picked up yet
    When an operator opens the license in use
    Then the seats row shows the Developer seats moving from 0 to 5, waiting for sync

  @integration
  Scenario: Extending again while a replacement waits extends the replacement
    Given a bound license with a replacement the install has not picked up yet
    When an operator extends the term again
    Then the replacement is the license reissued, not the one it replaces

  @integration
  Scenario: Extending a license no install has used shows the new key and stops the unused one
    Given a license no install has used yet
    When an operator extends its term
    Then the new license key is shown to send to the customer
    And the license it replaces is revoked, since no install holds it

  @integration
  Scenario: An extension whose unused key an install bound meanwhile keeps the new key for sync
    Given a license no install had used when the drawer opened
    When an operator extends its term and the registry refuses to retire the old key as in use
    Then the drawer says why the old key still works
    And the new key is kept behind "Install can't sync?" instead of being offered to send

  @integration
  Scenario: A new end date that does not extend the term cannot be saved
    Given an active license ending Dec 1
    When an operator picks Nov 20 as the new end date
    Then the save button is disabled and the form says the date must be after Dec 1

  @integration
  Scenario: An extension the registry refuses leaves the term as it was
    Given an active license ending Dec 1
    When an operator extends it and the registry refuses the reissue
    Then the drawer says the license was not extended
    And the term still reads Dec 1

  @integration
  Scenario: Revoking from the drawer also revokes the replacement waiting for delivery
    Given a bound license with a replacement the install has not picked up yet
    When an operator revokes the license from the drawer
    Then both the license and its replacement are revoked

  @integration
  Scenario: Revoking from the table also revokes the license the install still holds
    Given a bound license with a replacement the install has not picked up yet
    And the licenses table lists the chain as its replacement
    When an operator revokes that row from the table
    Then both the replacement and the license the install holds are revoked

  @unit
  Scenario: An unused-key revoke ends the managed key before it marks the license
    Given a license no install has used holds a managed key
    When ending its managed key fails
    Then the license is not marked revoked and stays live
    And revoking it again ends the key and marks the license

  @unit
  Scenario: An install that binds while its unused key is being ended gets a fresh key
    Given an unused-key revoke ended the license's managed key
    And an install bound the license before the revoke marked it
    When the revoke's conditional write is refused
    Then the license stays live and bound, and lets go of the ended key
    And the install's next sync provisions a new managed key

  @integration
  Scenario: Only a live license lets go of an ended managed key
    Given a live license and a revoked license each name a managed key that was ended
    When licensing lets go of each ended key
    Then the live license no longer names its key
    And the revoked license keeps the key it names

  @unit @integration
  Scenario: A revoke ends a key that attached while it ran
    Given an operator revokes a bound license
    And gateway attaches a new key for that install before the revoke marks the row
    When the revoke tries to mark the license
    Then the mark is refused because the license names another key
    And the new key is ended before the license is marked revoked
    And if ending the new key fails, the license stays live and revoking again finishes the job

  @integration
  Scenario: Retiring an unused key that failed for another reason keeps the new key for the customer
    Given no install holds the license
    And an operator signs a replacement
    When retiring the unused key fails for a reason other than an install binding it
    Then the drawer still offers the new key for the customer to paste
    And it says the unused key still works

  @integration
  Scenario: An unused key a failed retirement left working can be ended from the drawer
    Given retiring the unused key failed after an operator signed a replacement
    When the operator chooses End the unused key
    Then the registry ends the key and the drawer stops saying it still works

  @integration
  Scenario: An unused key left working still shows after the drawer is opened again
    Given no install holds a license whose replaced key still works
    When an operator opens the license in the drawer
    Then the drawer says the unused key still works and offers End the unused key

  @integration
  Scenario: Revoking reaches a replacement signed after the dialog opened
    Given the revoke dialog is open on a license
    And another operator signs a replacement for it
    When the operator confirms the revoke
    Then the new replacement is revoked too

  @integration
  Scenario: A revoke that failed part way finishes on retry without repeating a revoked license
    Given a chain of three live licenses
    And revoking failed after the first of them was revoked
    When the operator confirms the revoke again
    Then the license already revoked is not sent again
    And the rest of the chain is revoked, the selected license last
