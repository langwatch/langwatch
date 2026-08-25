Feature: The SCIM reconciliation surfaces - directory sync you can read
  As an administrator whose identity provider manages my organization's people
  I need to see what the directory did, what it failed to do, and what it
  will do next, in words I can act on
  So that "is sync working" stops being a support ticket, and so that a
  person the directory removed is a fact I can point at rather than a row
  somebody has to go looking for

  # ADR-122, implemented with D08's remainder. Everything both views show is
  # a read of event truth: the scim_sync_state projection, the
  # (connectionId, externalId) -> userId mapping, scim_apply_failed events,
  # and the grants facts the directory authored (source: "scim"). Neither
  # view adds a write path to sync, with one named exception: the operator
  # re-drive.
  #
  #   the directory pushes
  #        │
  #        ▼
  #   ┌ org view ──── on the SCIM settings page, per connection:          ┐
  #   │               state and what it waits for · last push · how many  │
  #   │               people are managed · recent directory-caused        │
  #   │               changes, removals included · failures as words      │
  #   │               (permission: see single sign-on; managing tokens    │
  #   │                and mappings still takes manage)                   │
  #   ├ ops view ──── on the operator surface, across every customer:     │
  #   │               every connection's state · dead letters linked to   │
  #   │               their retired intents · retry history · the         │
  #   │               externalId ↔ userId mapping detail                  │
  #   └ the one act ─ an operator may re-drive a retired apply: guarded,  ┘
  #                   recorded, idempotent, refused unless retired
  #
  # The org view is organization-scoped at the data layer, like the D05 org
  # surface: the scope is where the query is built from, not a filter, so
  # nothing the reader sends can name another organization.

  Background:
    Given an organization "acme" with an SSO connection "acme-okta" holding a directory token
    And "acme"'s administrator "ana" may manage single sign-on
    And a second organization "globex" with its own connection, token, and administrator
    And the directory has pushed people into "acme" through "acme-okta"

  # ── The organization view: status ──────────────────────────────────────

  @integration @unimplemented
  Scenario: A connection's sync state is on the SCIM settings page
    When "ana" opens the SCIM settings page
    Then "acme-okta" is listed with its current sync state
    And the state says what it is waiting for, in words, not a code

  @integration @unimplemented
  Scenario: The last push and the people managed are counted per connection
    When "ana" opens the SCIM settings page
    Then "acme-okta" shows when the directory last pushed
    And how many of "acme"'s people the directory currently manages

  @integration @unimplemented
  Scenario: A connection the directory has never pushed to says so calmly
    Given "acme" holds a second connection whose token has never been used
    When "ana" opens the SCIM settings page
    Then that connection reads as waiting for its first push
    And nothing about it reads as an error

  # ── The organization view: what the directory did ──────────────────────

  @integration @unimplemented
  Scenario: People the directory removed are listed as the directory's act
    Given the directory deactivated "sam" in its last push
    When "ana" opens the reconciliation panel for "acme-okta"
    Then "sam" appears in the recent directory-caused changes
    And the change names the directory as its author, with when it happened

  @integration @unimplemented
  Scenario: A directory-caused change and the audit page tell the same story
    Given the directory deactivated "sam" in its last push
    Then the change the reconciliation panel shows for "sam"
    And the entry on the organization's audit page
    Are explained by the same recorded facts

  @integration @unimplemented
  Scenario: A failed apply reaches the administrator as words to act on
    Given the directory's last push contained an operation that could not be applied
    When "ana" opens the reconciliation panel for "acme-okta"
    Then the failure is listed in words a customer understands
    And it says what will resolve it
    And no internal error code or intent identifier is shown

  @integration @unimplemented
  Scenario: The organization view offers no retry
    Given the directory's last push contained an operation that could not be applied
    When "ana" opens the reconciliation panel for "acme-okta"
    Then no control offers to re-run the failed operation
    And the remediation copy says the directory's next push is what re-asserts it

  # ── The organization view: scope and permission ─────────────────────────

  @integration @unimplemented
  Scenario: Another organization's connection is not there to read
    When "ana" opens the SCIM settings page
    Then nothing from "globex" is listed
    And naming "globex"'s connection in a request answers as if it did not exist

  @integration @unimplemented
  Scenario: Seeing sync status and managing tokens are two different permissions
    Given "rio" of "acme" may see single sign-on but not manage it
    When "rio" opens the SCIM settings page
    Then the reconciliation panel reads normally
    And minting, revoking, and group-mapping controls are not offered

  # ── The operator view ───────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Every customer's connections are one operator list
    Given a platform operator opens the SCIM oversight surface
    Then connections across organizations are listed with their sync states
    And the list searches and pages the way the other operator lists do

  @integration @unimplemented
  Scenario: A dead letter opens to the intent behind it
    Given an apply for "acme-okta" retired as unretryable
    When the operator opens that failure
    Then it links to the retired intent, its error, and its retry history

  @integration @unimplemented
  Scenario: The mapping detail is the operator's, not the customer's
    When the operator opens a person the directory manages in "acme"
    Then the external identifier the directory knows them by is shown per connection
    And the organization view never shows that identifier

  @integration @unimplemented
  Scenario: The surface is refused without platform operator access
    Given a signed-in user who is not a platform operator
    When they request the SCIM oversight surface
    Then it is refused the same way an unregistered address is refused

  # ── The one write: the guarded re-drive ─────────────────────────────────

  @integration @unimplemented
  Scenario: Re-driving a retired apply is a recorded act
    Given an apply for "acme-okta" retired as unretryable
    And its cause has been fixed
    When the operator re-drives it
    Then the apply runs again
    And the re-drive is recorded with the operator on it

  @integration @unimplemented
  Scenario: An apply that is not retired cannot be re-driven
    Given an apply for "acme-okta" that is still being retried
    When the operator attempts to re-drive it
    Then the re-drive is refused with words saying why

  @integration @unimplemented
  Scenario: Re-driving twice applies once
    Given an apply for "acme-okta" retired as unretryable
    When the operator re-drives it twice
    Then the directory's operation is applied exactly once

  # ── Rebuildability ──────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Replay rebuilds everything the views show
    Given both views have been read for "acme"
    When the reconciliation projections are rebuilt from the event log
    Then the rebuilt views show what the live views showed
