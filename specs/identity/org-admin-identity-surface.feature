Feature: The organization identity surface - how everybody here signs in
  As the administrator of an organization
  I need to see how each of my people signs in, and to confirm the sign-ins
  that need a human, without ever seeing anybody else's organization
  So that an account-linking dead end is something I resolve myself, and so
  that a mistake on this surface cannot reach another organization's data

  # D05 (epic R7; ADR-117 §3 for what a proposed sign-in is). The second of
  # the two identity surfaces, and deliberately not the same surface as the
  # operator one: separate pages, separate addresses, separate queries. The
  # two share command handlers and nothing else.
  #
  # It lives in organization settings, beside the members list it absorbs
  # the invitation panels from (D11 shipped those onto the members page;
  # they move here).
  #
  #   Organization settings -> Identity
  #     ┌ waiting ────── sign-ins an administrator has to confirm, each     ┐
  #     │                saying what the provider asserted and what the     │
  #     │                account already holds                              │
  #     ├ members ────── how each person here signs in, and what proved it  │
  #     └ invitations ── outstanding invitations, their expiry, and resend  ┘
  #
  # ORGANIZATION-SCOPED AT THE DATA LAYER. The scope is not a filter this
  # surface applies; it is where the query is built from. Nothing the reader
  # sends can name a different organization, so a bug here cannot leak one.
  # That is a structural claim and the scenarios below are written to fail
  # if it stops being true.
  #
  # Approving somebody's request to join arrives with D12 and lands on this
  # surface. Nothing here anticipates it beyond leaving the room.

  Background:
    Given an organization "acme" whose administrator "ana" may manage single sign-on
    And a second organization "globex" with its own administrator and its own members
    And "sam" is a member of "acme"

  # ── Sign-ins waiting for a human ───────────────────────────────────────

  @integration @unimplemented
  Scenario: Sign-ins that need confirming are listed with what each side asserted
    Given a sign-in through "acme"'s identity provider is waiting to be confirmed
    When "ana" opens the identity settings
    Then the waiting sign-in is listed with the address the provider asserted and the methods the account already holds
    And it says what confirming would attach, before she confirms anything

  @integration @unimplemented
  Scenario: Confirming attaches the method and the person gets in next time
    Given a sign-in for "sam@acme.com" is waiting to be confirmed
    When "ana" confirms it
    Then the method is attached through the ordinary ceremony, with "ana" recorded as who confirmed it
    And "sam" signs in with it next time without anybody acting again

  @integration @unimplemented
  Scenario: Rejecting records the decision and takes nothing away
    Given a sign-in for "sam@acme.com" is waiting to be confirmed
    When "ana" rejects it
    Then the rejection is recorded with "ana" on it
    And "sam" keeps every method held before, and the person who tried is told to use one of those

  @unit @unimplemented
  Scenario: A sign-in somebody already decided cannot be decided again
    Given a waiting sign-in a LangWatch operator already confirmed
    When "ana" decides it
    Then it is refused with the code "identity_link_proposal_resolved"
    And the words say it was already decided

  @unit @unimplemented
  Scenario: Nothing waiting reads as an empty page
    Given no sign-in in "acme" is waiting to be confirmed
    When "ana" opens the identity settings
    Then the waiting panel is one line saying nothing needs her
    And the rest of the surface is where her attention goes

  # ── Organization scope is structural ───────────────────────────────────

  @integration @unimplemented
  Scenario: A waiting sign-in belonging to another organization is not listed
    Given a sign-in in "globex" is waiting to be confirmed
    When "ana" opens "acme"'s identity settings
    Then it is not listed
    And nothing on the page counts it

  @unit @unimplemented
  Scenario: Acting on another organization's waiting sign-in answers as if it did not exist
    Given a waiting sign-in in "globex"
    When "ana" confirms it by naming it directly
    Then the answer is the same one she would get for a sign-in that never existed
    And nothing in the answer confirms that "globex" holds it

  @unit @unimplemented
  Scenario: The organization cannot be chosen by whoever is reading
    When any query behind this surface is built
    Then the organization comes from the scope the reader is already in
    And no value the reader sends can name a different one

  @integration @unimplemented
  Scenario: An administrator of two organizations sees each one only where they are
    Given "ana" administers both "acme" and "globex"
    When she opens the identity settings in "acme"
    Then only "acme"'s people, invitations and waiting sign-ins are listed
    And switching to "globex" replaces every one of them rather than adding to them

  # ── How each person signs in ───────────────────────────────────────────

  @integration @unimplemented
  Scenario: Every member is listed with the ways they can sign in
    When "ana" opens the members view of the identity settings
    Then each member is listed with the sign-in methods that get them into "acme"
    And each method says what proved it and when

  @unit @unimplemented
  Scenario: The list says how somebody signs in, never where else they belong
    When "ana" reads a member's sign-in methods
    Then she reads how that person gets into "acme"
    And nothing names another organization that person belongs to

  @integration @unimplemented
  Scenario: A member whose only way in is the organization's connection is marked as such
    Given "sam"'s only sign-in method comes from "acme"'s identity provider
    When "ana" reads the members view
    Then "sam" is marked as depending on that connection
    And the marking says what would happen to "sam" if the connection went away

  @integration @unimplemented
  Scenario: The members view searches and pages like every other settings list
    Given "acme" has more members than fit on one page
    When "ana" searches for a person or a sign-in method
    Then the list narrows, pages and shows its empty state the way the other settings lists do
    And each row's actions are in that row's overflow menu

  # ── Invitations, absorbed onto this surface ────────────────────────────

  @integration @unimplemented
  Scenario: Outstanding invitations live here with their expiry
    When "ana" opens the identity settings
    Then every outstanding invitation is listed with who it went to and when it expires
    And an invitation past its expiry says so rather than looking live

  @integration @unimplemented
  Scenario: Resending from here behaves exactly as resending behaves elsewhere
    Given an invitation to a colleague has expired
    When "ana" resends it
    Then a fresh invitation goes out, the previous one stops working, and the throttle still applies
    And nothing about resending differs because it happened here

  # ── The organization's own connection ──────────────────────────────────

  @integration @unimplemented
  Scenario: The organization reads its connection's state and what it is waiting for
    Given "acme"'s connection is waiting for its domain proof
    When "ana" opens the identity settings
    Then the connection's state is shown with what it is waiting for and what to do about it
    And no internal name, flag or service appears in any of those words

  @unit @unimplemented
  Scenario: An administrator who may see single sign-on but not manage it changes nothing
    Given "ana" may see single sign-on but may not manage it
    When she opens the identity settings
    Then the connection, the members and the waiting sign-ins are readable
    And no control she cannot use is rendered at all

  @unit @unimplemented
  Scenario: Confirming a sign-in needs the single sign-on permission, and the rest needs member management
    Given somebody who may manage members but may not manage single sign-on
    When they open the identity settings
    Then invitations and members are theirs to manage
    And confirming a waiting sign-in is not offered to them

  # ── Reachability and words ─────────────────────────────────────────────

  @unit @unimplemented
  Scenario: The identity settings open from the settings menu
    Given the settings menu offers the identity settings
    When each menu link is resolved against the application's route table
    Then the identity entry resolves to a route registered for that exact path
    And no link falls through to the catch-all route

  @unit @unimplemented
  Scenario: A refusal on this surface reads as advice, not as an error code
    When any action here is refused for a reason we can name
    Then the reader sees the words registered for that reason
    And the reader never sees a code, an internal name, or "unknown error"
