Feature: The platform operator identity lookup - the end of database surgery
  As a LangWatch operator holding a support case about somebody who cannot
  sign in
  I need one address to answer every question about that person, and every
  repair to be a guarded, recorded act
  So that a support case is resolved on a page instead of in a database
  console, and so that what an operator saw and did is always answerable

  # D05 (epic R7; ADR-117 §1 and §3 for the routing vocabulary this surface
  # reads; ADR-101 §4 for what the history may carry). This is the surface
  # the deliverable exists for: it is the designated replacement for hand-
  # written SQL, and until it exists that is still how these cases end.
  #
  # It extends the operator surfaces that already exist rather than opening
  # a new kind. It is reached from the operator menu, it is refused to
  # anybody without platform operator access the same way an unregistered
  # address is refused, and it lists, searches, pages, opens a drawer and
  # puts its row actions in an overflow menu the way the other operator
  # lists do.
  #
  #   an email address in
  #        │
  #        ▼
  #   ┌ routing ───── what the front door would decide for it, and the ────┐
  #   │               reason it would carry                                │
  #   ├ people ────── every user holding any part of that address, with    │
  #   │               the organizations they belong to                     │
  #   ├ methods ───── per person, every sign-in method in every state,     │
  #   │               what proved it and when                              │
  #   ├ waiting ───── sign-ins awaiting confirmation · invitations with    │
  #   │               their expiry · domain claims awaiting review         │
  #   └ history ───── the most recent identity facts, newest first         │
  #        │
  #        ▼
  #   actions, each one a guarded command with the operator on it:
  #     confirm a proposed sign-in · reject one · detach a method ·
  #     resend an invitation · extend one · end somebody's sessions ·
  #     approve a domain claim · reject a domain claim · attest a domain
  #
  # THE READ IS ITSELF THE ACT. Resolving an address here crosses every
  # organization on the installation, so it is authorized and recorded
  # whether or not anything is then changed. A cross-organization read is
  # never unrecorded. That is the rule this surface is built around, and it
  # is the one thing about it that has no equivalent anywhere else in the
  # back office today, where reads pass unrecorded and only writes are kept.

  Background:
    Given a LangWatch operator "olive" with platform operator access
    And an organization "acme" with a member "sam" whose work address is "sam@acme.com"

  # ── The read is authorized, and the read is recorded ───────────────────

  @integration @unimplemented
  Scenario: Resolving an address across organizations is recorded as an act
    When "olive" looks up "sam@acme.com"
    Then a record names "olive", the address she resolved and when she resolved it
    And that record is written whether or not she then changes anything

  @unit @unimplemented
  Scenario: A lookup that finds nobody is recorded exactly like one that finds somebody
    When "olive" looks up an address nobody holds
    Then the answer says nobody holds it
    And the same record is written against "olive"

  @integration @unimplemented
  Scenario: A refused lookup is recorded as an attempt, and reveals nothing
    Given "mallory" holds no platform operator access
    When "mallory" requests the lookup for "sam@acme.com"
    Then the request is refused and nothing about the address comes back
    And the attempt is recorded with who made it

  @unit @unimplemented
  Scenario: Without platform operator access the surface is not there at all
    Given "mallory" holds no platform operator access
    When "mallory" opens the lookup address directly
    Then the answer is indistinguishable from an address this installation does not serve
    And nothing tells "mallory" the surface exists

  @integration @unimplemented
  Scenario: Who looked somebody up is readable by an operator, on this surface
    Given several operators have resolved addresses today
    When "olive" opens what operators have done recently
    Then who resolved which address, and when, is readable
    And it is the same trail the repairs write to, not a second one

  @unit @unimplemented
  Scenario: The recorded address is the address, and the history is not a copy of the person
    When any lookup is recorded
    Then the record carries the address resolved and who resolved it
    And it carries no password, no token and no session value

  # ── What the lookup answers ────────────────────────────────────────────

  @integration @unimplemented
  Scenario: One address answers the question the front door would answer
    When "olive" looks up "sam@acme.com"
    Then the routing decision the front door would reach is shown with the reason it carries
    And the words beside it are the ones the person signing in would have read

  @integration @unimplemented
  Scenario: Every person holding any part of the address is listed
    Given "sam@acme.com" is held by one user as a proved method and by a second user as a detached one
    When "olive" looks the address up
    Then both users are listed, each with the organizations they belong to
    And neither is presented as the only answer

  @unit @unimplemented
  Scenario: Each person's sign-in methods are listed whatever state they are in
    When "olive" opens a person from the lookup
    Then every sign-in method that person holds is listed, in every state
    And each says what proved it, when it was attached, and when it stopped counting if it has

  @integration @unimplemented
  Scenario: The most recent identity history is shown newest first
    When "olive" opens a person from the lookup
    Then the most recent facts about that person's identity are listed newest first
    And each says what happened, who caused it and when

  @integration @unimplemented
  Scenario: Everything waiting on a human is on one panel
    When "olive" opens a person from the lookup
    Then sign-ins awaiting confirmation, invitations with their expiry, and domain claims awaiting review are on one panel
    And a panel with nothing waiting collapses to a single line rather than filling the page to say so

  @unit @unimplemented
  Scenario: The address is resolved the way the front door resolves it
    When "olive" pastes an address with different capitalization and a plus tag
    Then it resolves to the person the front door would have resolved
    And what she typed and what it resolved to are both on screen

  @unit @unimplemented
  Scenario: People and organizations are shown by name, never by identifier alone
    When any result is rendered
    Then organizations and people are named
    And an identifier that must be shown is shortened in its middle, with a way to copy it whole

  @integration @unimplemented
  Scenario: An organization's own connection state is readable from the person who signs in through it
    Given "acme" signs in through a connection that is paused
    When "olive" looks up "sam@acme.com"
    Then the connection and its state are named beside the routing decision
    And the reason the front door would give matches the connection's state

  # ── Repairing a person's sign-in ───────────────────────────────────────

  @integration @unimplemented
  Scenario: Confirming a proposed sign-in attaches the method and lets the person in
    Given a sign-in for "sam@acme.com" is waiting for somebody to confirm it
    When "olive" confirms it
    Then the method is attached through the ordinary ceremony, with "olive" recorded as who confirmed it
    And "sam" signs in with it the next time without anything else happening

  @integration @unimplemented
  Scenario: Rejecting a proposed sign-in records the decision and changes nothing else
    Given a sign-in for "sam@acme.com" is waiting for somebody to confirm it
    When "olive" rejects it
    Then the rejection is recorded with "olive" on it
    And "sam" keeps every method held before, and gains none

  @unit @unimplemented
  Scenario: A proposal somebody already decided cannot be decided twice
    Given a proposal another operator already confirmed
    When "olive" decides it
    Then it is refused with the code "identity_link_proposal_resolved"
    And the words say what was already decided and by whom

  @integration @unimplemented
  Scenario: Detaching somebody's last way in is refused
    Given "sam" holds exactly one working sign-in method
    When "olive" detaches it
    Then it is refused with the code "identity_detach_strands_user"
    And the words name what "sam" would be left with, which is nothing

  @integration @unimplemented
  Scenario: Detaching a method somebody has a replacement for takes effect and is recorded
    Given "sam" holds a work method and a personal one, both working
    When "olive" detaches the personal one
    Then the detachment is recorded with "olive" on it
    And "sam" signs in with the work method, and the personal one no longer signs anybody in

  @integration @unimplemented
  Scenario: Sessions can be ended for a person or for one of their sign-in methods
    Given "sam" is signed in on two devices through different methods
    When "olive" ends the sessions belonging to one method
    Then that device is signed out and the other stays signed in
    And ending the person's sessions instead signs both out

  @unit @unimplemented
  Scenario: Every repair names the organization it lands on before it runs
    When "olive" starts any repair from this surface
    Then the confirmation names the organization and the person by name
    And it says what will change, in words a person reads rather than a value

  @unit @unimplemented
  Scenario: A repair whose target cannot be named is withheld rather than confirmed
    Given the organization behind a result cannot be named
    When "olive" opens the row's actions
    Then the repairs are not offered
    And the row says why, without offering a confirmation against something unreadable

  @unit @unimplemented
  Scenario: An operator who may look but not repair is shown nothing they cannot use
    Given "olive" may see the lookup but may not act on it
    When she opens a person
    Then everything readable is readable
    And no repair is rendered, rather than rendered and refused when pressed

  # ── Invitations, from the operator's side ──────────────────────────────

  @integration @unimplemented
  Scenario: Outstanding invitations are listed with what is left of them
    When "olive" looks up an address that was invited and never accepted
    Then the invitation is listed with the organization, who sent it, and when it expires
    And an invitation past its expiry says so rather than looking live

  @integration @unimplemented
  Scenario: Resending an invitation from here does what resending does anywhere
    Given an invitation to "sam@acme.com" has expired
    When "olive" resends it
    Then a fresh invitation goes out and the previous one stops working
    And the resend is recorded with "olive" on it

  @unit @unimplemented
  Scenario: Extending an invitation moves its expiry and says by how much
    Given an invitation expires tomorrow
    When "olive" extends it
    Then the new expiry is shown as a date, not as a duration the reader has to add up
    And the extension is recorded with "olive" on it

  # ── Domain claims awaiting review ──────────────────────────────────────

  @integration @unimplemented
  Scenario: Approving a domain claim leaves the customer able to carry on alone
    Given "acme" has claimed "acme.com" and is waiting
    When "olive" approves the claim
    Then "acme" can ask for its domain proof without anybody else acting
    And the approval is recorded with "olive" on it

  @integration @unimplemented
  Scenario: Approving a claim for a customer being onboarded leads straight into attesting it
    Given "olive" has just approved "acme"'s claim on "acme.com" while onboarding it
    When she attests the domain in the same sitting
    Then "acme" is asked to publish nothing and to wait for nobody
    And the approval and the attestation are two facts, each recorded against "olive"

  @integration @unimplemented
  Scenario: Rejecting a domain claim needs a note, and the customer reads that note
    Given "acme" has claimed "acme.com" and is waiting
    When "olive" rejects the claim without writing a note
    Then the rejection is refused until she writes one
    And once written, the note is what "acme" reads, unchanged

  @unit @unimplemented
  Scenario: A claim another operator already decided cannot be decided again
    Given another operator already approved "acme"'s claim
    When "olive" decides it
    Then it is refused with the code "sso_domain_claim_already_decided"
    And the words say what was decided and by whom

  @integration @unimplemented
  Scenario: The claims queue puts the longest wait first and says how long it has been
    Given claims from several organizations are waiting
    When "olive" opens the queue
    Then the longest-waiting claim is first, with how long it has waited
    And the queue is empty-stated in one line when nothing is waiting

  # ── The surfaces stay separate, structurally ───────────────────────────

  @unit @unimplemented
  Scenario: The operator lookup shares no page, address or query with the organization surface
    When the operator lookup and the organization identity surface are compared
    Then they share no page and no address
    And no query serving one can be reached from the other

  @unit @unimplemented
  Scenario: Every repair is a guarded command, and no raw edit exists on the surface
    When any repair on this surface runs
    Then it is a guarded command carrying the operator as the actor
    And no control on the surface writes a row directly

  @unit @unimplemented
  Scenario: Every page this surface adds opens from the operator menu
    Given the operator menu offers the identity lookup
    When each menu link is resolved against the application's route table
    Then each resolves to a route registered for that exact path
    And no link falls through to the catch-all route

  @unit @unimplemented
  Scenario: A refused repair says what to do about it, never "unknown"
    When a repair is refused for a reason we can name
    Then the answer carries a stable code and the words registered for it
    And an operator reading it knows what to try next
