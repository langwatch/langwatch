@integration
Feature: Developer seat
  As an organisation administrator
  I want a Developer seat that gives a person their own project and nothing shared
  So that developers can send traces today without using a capped seat

  # Design record: dev/docs/adr/143-developer-seat.md (Accepted).
  # A Developer owns a personal project, may act inside it (CLI, queries,
  # evaluations), never sees a shared project, is counted but never capped,
  # and may be downgraded from a Full seat. One organisation setting decides
  # which seat self-service and SSO joiners receive.

  Background:
    Given an organisation with one shared team and one shared project

  # ============================================================================
  # Admission
  # ============================================================================

  Scenario: An administrator invites a Developer while the plan is at its seat cap
    Given the organisation has no Full or Light seats left on its plan
    When an administrator invites a person with the seat "Developer"
    Then the invitation is created
    And after the person accepts they hold access to their personal team only

  Scenario: The joiner seat setting is Full by default
    Given the organisation admits people who sign in with a company email
    And the organisation has not changed its joiner seat
    When a person joins with a matching company email
    Then they are admitted as a Full member
    And they hold the organisation-wide access a Full member holds today

  Scenario: The joiner seat setting lands email joiners as Developers
    Given the organisation's joiner seat is set to "Developer"
    When a person joins with a matching company email
    Then they are admitted as a Developer
    And they hold access to their personal team only

  Scenario: The joiner seat setting lands SSO joiners as Developers
    Given the organisation's joiner seat is set to "Developer"
    When a person is admitted through single sign-on for the first time
    Then they are admitted as a Developer
    And they hold access to their personal team only

  Scenario: The joiner seat setting never applies to invitations
    Given the organisation's joiner seat is set to "Developer"
    When an administrator invites a person with the seat "Full"
    Then after the person accepts they are a Full member

  Scenario: Shutting the door leaves the joiner seat an administrator can no longer see untouched
    Given the organisation's joiner seat is "Full"
    And no single sign-on connection admits people
    When an administrator picks the seat "Developer" and then shuts the door before saving
    Then the seat choice is no longer shown
    And saving sends no joiner seat at all, so whatever seat is in force stays in force

  # ── Arrivals from the terminal ─────────────────────────────────────────
  #
  # `langwatch login` opens the browser on the device-approval page, which
  # sends a brand-new account through sign-up and on to the welcome screen
  # with the terminal's continuation in hand. A developer who arrives that
  # way wants their own project and the CLI pointed at it, and nothing
  # shared. So a join request made on that path carries its origin, and the
  # seat it lands in is decided by the origin rather than by the
  # organisation's joiner seat: a Developer, on approval and on an automatic
  # door alike. Approval stays one click and still carries no role choice
  # (specs/identity/join-requests.feature); raising a Developer to Full is
  # the separate act it already is on the members page. A request made on
  # the web is untouched. The origin can only ever LOWER the seat, so the
  # browser may assert it: a client that lies about it gets less, never more.
  #
  # Boundaries, named so nobody reads these as wider than they are:
  # - The sign-up that finishes through the emailed confirmation link opens a
  #   NEW tab. The continuation only survives because the link carries it
  #   (scenario below); without that the person lands on the ordinary join
  #   page and the request is a web one.
  # - A person whose single sign-on connection queued them already holds a
  #   request the sign-in made, which carries no terminal origin. A later
  #   terminal arrival cannot open a second one, so they land the joiner seat.
  # - On an installation where accounts are created by invitation only, the
  #   invitation screen runs before the welcome screen and nothing here is
  #   reached.

  Scenario: A request made from the terminal lands as a Developer when approved
    Given the organisation accepts requests to join from its domain
    And the organisation's joiner seat is "Full"
    When a person signs up from "langwatch login" with a matching company email, reaches the welcome screen and asks to join
    And an administrator approves the request with one click
    Then they are admitted as a Developer
    And they hold access to their personal team only
    And the admission is recorded as a Developer seat granted to a request from the terminal

  Scenario: A request made from the terminal walks in as a Developer where the door is automatic
    Given the organisation admits verified colleagues on its domain automatically
    And the organisation's joiner seat is "Full"
    When a person signs up from "langwatch login" with a matching company email and reaches the welcome screen
    Then they are admitted as a Developer without anybody approving
    And they hold access to their personal team only
    And the seat was decided from the request in hand, not read back from a row that may not exist yet

  Scenario: The emailed confirmation link brings the terminal's continuation along
    Given a person started sign-up from "langwatch login" and asked for the confirmation email
    When they open the link in a fresh tab
    Then the tab carries on to the device-approval page the terminal is waiting on
    And a continuation that is not a path on this site is dropped rather than followed

  Scenario: A request made on the web keeps the organisation's joiner seat
    Given the organisation accepts requests to join from its domain
    And the organisation's joiner seat is "Full"
    When a person signs up on the web with a matching company email and asks to join
    And an administrator approves the request with one click
    Then they are admitted as a Full member

  Scenario: The pending list shows the seat each request will land as
    Given one request made from the terminal and one made on the web are waiting
    And the organisation's joiner seat is "Full"
    When an administrator opens the pending requests
    Then the request from the terminal is marked "Developer" and the one from the web "Member"
    And neither mark can be changed there, because approval carries no role choice

  # ============================================================================
  # What a Developer can and cannot reach
  # ============================================================================

  Scenario: A Developer never sees a shared project
    Given a Developer in the organisation
    When the Developer asks for the list of projects they can open
    Then the list contains only their personal project
    And a request to view traces in the shared project is refused

  Scenario: A Developer works inside their own project
    Given a Developer with a personal project
    When they log in through the CLI and send a trace
    Then the trace is stored in the personal project
    And they can query and evaluate it there

  Scenario: CLI login refuses a shared project for a Developer
    Given a Developer logging in through the CLI
    When they pick a project that is not their personal project
    Then the login is refused with a message naming the Developer seat

  Scenario: A Developer cannot be given a role on a shared team
    Given a Developer in the organisation
    When an administrator tries to give them a role on the shared team
    Then the request is refused with a message naming the Developer seat
    And the Developer still holds access to their personal team only

  Scenario: A Developer is offered the Me product and nothing organisation-wide
    Given a Developer in an organisation with the Gateway and Governance products switched on
    When the Developer opens the product switcher
    Then Me is offered
    And Gateway and Governance are not offered

  Scenario: A Developer cannot open an organisation-wide product by address
    Given a Developer in the organisation
    When they open a Gateway page by its address
    Then the page says they do not have access
    And a page of their own Me workspace still opens

  Scenario: A Developer never sees the organisation's gateway keys
    Given a Developer in the organisation
    And the organisation holds a gateway key shared with every member
    When the Developer asks for the list of gateway keys
    Then the shared key is not in the list

  # ============================================================================
  # Downgrade
  # ============================================================================

  Scenario: Downgrading a Full member to Developer removes shared access
    Given a Full member with a role on the shared team
    And the organisation-wide access a Full member holds
    When an administrator changes their seat to "Developer"
    Then their shared team access is removed
    And their organisation-wide access is removed
    And each removal is written to the audit log
    And their personal project and its traces still exist
    And a request to view traces in the shared project is refused

  Scenario: The access dialog offers no shared access once the seat is Developer
    Given an administrator editing a Full member's access with team access staged
    When they pick the Developer seat
    Then the dialog says a Developer works in their own project only
    And it offers no way to add team or project access
    And the staged team access is dropped

  Scenario: A key on a shared project stops working after downgrade
    Given a Full member who owns a key scoped to the shared project
    And the same member owns a key scoped to their personal project
    When an administrator changes their seat to "Developer"
    Then a request with the shared-project key is refused
    And a request with the personal-project key succeeds

  # ============================================================================
  # Counting
  # ============================================================================

  Scenario: Developers are counted and never capped
    Given a plan that allows 5 Full seats and 5 Light seats, all in use
    When ten Developers are added
    Then all ten are admitted
    And the plan page shows 5 Full, 5 Light and 10 Developer seats
    And the Full and Light counts did not change

  # ============================================================================
  # Directory sync
  # ============================================================================

  Scenario: Directory sync leaves a Developer alone
    Given a Developer in an organisation synced from a customer directory
    When a sync arrives that places the person in an ordinary member group
    Then the person is still a Developer

  # ============================================================================
  # Public API
  # ============================================================================

  Scenario: The management API accepts the Developer seat
    Given an organisation administrator using the management REST API
    When they create an invitation with the seat "Developer"
    Then the invitation is created
    And the API documentation lists "Developer" as a seat
