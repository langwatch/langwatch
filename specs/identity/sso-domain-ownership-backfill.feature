Feature: Single sign-on domain ownership for connections set up before it was recorded
  As an administrator whose single sign-on connection proved its domain
  before the ownership table existed
  I need that domain to keep routing sign-ins to my connection
  So that an upgrade does not quietly stop my people signing in

  # The fold writes each connection's ownership rows with its head. Heads
  # folded before that change hold proved domains with no ownership row; a
  # system migration re-derives the rows from the heads by the fold's rule.

  @unit
  Scenario: A proved domain of an existing connection is recorded as owned
    Given "acme"'s live connection proved "acme.com" before ownership was recorded
    When the ownership backfill runs for "acme"
    Then "acme.com" is recorded as owned by that connection
    And the organization's backfill is finished

  @unit
  Scenario: A domain another organization already owns is left for an operator
    Given "acme.com" is owned by "globex"'s live connection
    And "acme"'s connection also names "acme.com" as proved
    When the ownership backfill runs for "acme"
    Then "acme"'s connection is reported as refused, naming the domain
    And the backfill for "acme" is not marked finished, so it is tried again

  @unit
  Scenario: An organization with no connection has nothing to backfill
    Given "initech" has no single sign-on connection
    When the ownership backfill runs for "initech"
    Then the organization's backfill is finished with nothing written
