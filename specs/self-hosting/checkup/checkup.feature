Feature: The checkup page of a self-hosted install
  Settings, Checkup answers one question no other screen answers: is this
  install correctly wired. Each row reports one of three verdicts: pass, fail,
  or not checked. Not checked is an answer in its own right and is never shown
  as a pass. A fail names what to do and links the page that explains it.

  The cheap checks run when the page opens. The checks that cost egress or
  money run only when an administrator asks for them. The page also shows the
  exact usage report this install sends, with the switches that shrink it.

  As an administrator of a self-hosted install
  I want to see what is reachable, what is broken, and exactly what leaves the install
  So that I can fix my deployment and answer my own security review

  Background:
    Given a self-hosted install

  # ============================================================================
  # Three verdicts
  # ============================================================================

  @unit
  Scenario: A check that could not run reads as not checked, never as a pass
    Given a check whose probe throws before it can answer
    When the checkup runs
    Then the row reads not checked
    And the row says why it could not run

  @unit
  Scenario: A failed check names the fix and the page that explains it
    Given Postgres answers but a migration is still pending
    When the checkup runs
    Then the migrations row reads fail
    And the row names the command that applies the migration
    And the row links a docs page

  @unit
  Scenario: Every row carries one of the three verdicts
    When the checkup runs
    Then every row reads pass, fail or not checked
    And no row is missing

  # ============================================================================
  # Cheap checks run on page load
  # ============================================================================

  @unit
  Scenario: The install row names the release and the process role
    Given the install runs release "2026.9.3" as the "all" process
    When the checkup runs
    Then the install row reads pass and names both

  @unit
  Scenario: Redis that does not answer is a fail with the address it was tried at
    Given Redis does not answer at its configured address
    When the checkup runs
    Then the Redis row reads fail
    And the row names the address

  @unit
  Scenario: The Redis address is shown without its password
    Given REDIS_URL carries a password
    When the checkup runs, with Redis answering and with Redis not answering
    Then the Redis row names the host and port
    And the row never shows the password

  @unit
  Scenario: A ClickHouse install where the goose binary is absent leaves migrations not checked
    Given ClickHouse answers a ping
    And the goose binary is not on this install
    When the checkup runs
    Then the ClickHouse row reads pass
    And the ClickHouse migrations row reads not checked

  @unit
  Scenario: The usage report row reads the last report and its refusal
    Given the last usage report was refused with "usage_report_refused_413"
    When the checkup runs
    Then the usage report row reads fail
    And the row names the refusal

  @unit
  Scenario: Usage reporting switched off is not checked rather than failed
    Given usage reporting is switched off with DISABLE_USAGE_STATS
    When the checkup runs
    Then the usage report row reads not checked
    And the row says the variable that switched it off

  @unit
  Scenario: A license that names no hosted service leaves the connect rows unblocked rather than failed
    Given the organization holds a license that names no hosted service
    When the checkup runs
    Then the connect row reads not checked
    And the row says what a license with hosted services gives
    And the row names the activation code as the way in

  @unit
  Scenario: Connect switched off by the deployment is not checked with the variable named
    Given the deployment sets LANGWATCH_CONNECT_DISABLED
    When the checkup runs
    Then the connect row reads not checked
    And the row names LANGWATCH_CONNECT_DISABLED

  @unit
  Scenario: A connected install shows its last sync
    Given the organization holds a connected license that synced an hour ago
    When the checkup runs
    Then the connect row reads pass
    And the row names when the last sync happened

  # ============================================================================
  # Explicit checks behind a button
  # ============================================================================

  @unit
  Scenario: The explicit checks do not run on page load
    When the cheap checkup runs
    Then no request leaves the install
    And the rows that cost egress read not checked with the reason that they were not asked for

  @unit
  Scenario: Reaching the connect host names the host and port a firewall rule must allow
    Given the connect host cannot be reached
    When the explicit reachability check runs
    Then the connect host row reads fail with code "connect_unreachable"
    And the row names the host and the port

  @unit
  Scenario: A host that answers with any status is reachable
    Given the gateway host answers 404 to a probe
    When the explicit reachability check runs
    Then the gateway host row reads pass

  @unit
  Scenario: The model provider test respects the organization's egress budget
    Given the organization has used its model provider test budget for the minute
    When the explicit model provider check runs
    Then the model provider row reads not checked
    And the row names when to try again

  @unit
  Scenario: The storage probe writes and deletes one object
    Given a storage destination that accepts writes
    When the explicit storage check runs
    Then one object is written and then deleted
    And the storage row reads pass

  @unit
  Scenario: A canary that needs an input it was not given is not checked
    Given no scenario run plan was named
    When the explicit canaries run
    Then the scenarios row reads not checked
    And the row says which input it needs

  # ============================================================================
  # What we send
  # ============================================================================

  @unit
  Scenario: The page shows the exact report the install would send
    When the usage report preview is taken
    Then it is the same payload the sender would post
    And it names the host the report goes to

  @unit
  Scenario: The two switches change the preview
    Given an administrator switches the optional category off
    When the usage report preview is taken
    Then the preview carries no optional field

  @integration
  Scenario: The checkup page lists every row with its verdict
    When an administrator opens Settings, Checkup
    Then every cheap check is listed with a verdict
    And a not checked row is not coloured as a pass
    And the page links the ops dashboard rather than repeating it

  @integration
  Scenario: The checkup page is listed beside License and Connect on a self-hosted install
    When the settings menu is built for a self-hosted install
    Then "Checkup" is listed with the other install pages
    And it is not listed on LangWatch Cloud

  @integration
  Scenario: The usage report preview is copyable
    When an administrator opens the what we send section
    Then the payload is shown pretty printed
    And a copy button copies it
    And the two switches are beside it
