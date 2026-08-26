Feature: A code agent logs in once for a whole run
  As an operator running a code agent against an API behind a login
  I want one login to serve every row of the run
  So that the target system is not asked to authenticate once per row

  # The rows of an experiment or a dataset run are isolated so that they can run
  # in parallel, so every row starts cold. The agent cache is where the agent
  # keeps the session it produced, and the platform gives each run its own
  # credential for that cache, so the agent code needs no setup call and no
  # LangWatch secret.
  #
  # The scenarios below are bound to the committed example,
  # services/nlpgo/app/engine/blocks/codeblock/examples/shared_session_code_agent.py,
  # which the tests run through the real sandbox against a stub login service, a
  # stub protected API and a stub agent cache. The docs page publishes that same
  # file byte for byte.

  Background:
    Given a code agent that reads its session from the agent cache
    And a run that carries its own agent cache credential

  Rule: One login serves the rows that follow it

    @integration
    Scenario: The first row logs in and stores the session
      Given the cache holds no session
      When the row runs
      Then the row reads the cache before it logs in
      And the row logs in exactly once
      And the protected API is called with the session that login returned
      And the session is stored for less time than the target system promises

    @integration
    Scenario: A later row reuses the stored session
      Given the cache holds a live session
      When the row runs
      Then the row does not log in
      And the protected API is called with the stored session
      And the row writes nothing back

    @integration
    Scenario: A row logs in again once the stored session has lapsed
      Given the cache held a session whose lifetime has passed
      When the row runs
      Then the row logs in
      And the fresh session replaces the entry
      # The lifetime is the only thing that decides freshness. The agent stores
      # no timestamp and does no arithmetic on one.

    @integration
    Scenario: A row logs in again when the target refuses the stored session
      Given the cache holds a session the target system no longer accepts
      When the row runs
      Then the row is refused once
      And the row logs in and sends its work again
      And the new session replaces the entry for the rows that follow
      # The stored lifetime is what the target promised, not a promise it has
      # to keep: a restart, an operator closing the session or a password
      # change ends one early. Without this the whole run fails on a session
      # that stopped working, instead of paying for one login.

    @integration
    Scenario: A row reads a session stored after its own row started
      Given the row's snapshot was taken while the cache was empty
      And another row stored a session after that
      When the row runs
      Then the row uses the stored session rather than logging in
      # The read happens while the row runs, not when the row is prepared.

    @integration
    Scenario: Rows that start together log in once between them
      Given the cache holds no session
      When four rows start at the same moment
      Then exactly one row logs in
      And the claim is taken exactly once
      And every row answers with the session that row stored
      # The rows of the first wave all read the empty cache, so before the
      # claim they all logged in. The claim is what makes this a number: it
      # writes only when the name is free, so one row does the work and the
      # rows beside it read what it stored.

    @integration
    Scenario: A row logs in itself when the row that took the login stores nothing
      Given another row took the login and stored no session
      When the row runs
      Then the row waits rather than logging in at once
      And the row takes the login once that claim's lifetime passes
      And the row logs in and stores the session
      # A claim that no write follows must not hold the rows beside it for
      # good. The claim expires, the next row takes it, and the worst case is
      # the result every row gets with no claim at all.

  Rule: A cache that does not answer costs a login, never a row

    @integration
    Scenario: A row still answers when the session cannot be stored
      Given the cache refuses the write
      When the row runs
      Then the row still answers
      And the report on stderr names the entry and says the next row logs in again
      And the report carries neither the session nor the password

    @integration
    Scenario: A row still answers when the cache cannot be read
      Given the cache answers a server error
      When the row runs
      Then the row logs in and still answers
      And the report on stderr says this row logs in

    @integration
    Scenario: A cache failure never prints the run's credential
      Given the cache answers a server error
      When the row runs
      Then no captured output carries the run's credential
      # An exception text can quote the credential that caused it, and a run
      # shows what it printed, so the agent reports in its own fixed words.

    @integration
    Scenario: A run with no credential does its work once per row
      Given a run that carries no agent cache credential
      When two rows run
      Then each row logs in
      And no row calls the cache

  Rule: A failure names what the operator has to fix

    @integration
    Scenario: A rejected login names the failure and keeps the password out of it
      Given the target system refuses the login
      When the row runs
      Then the row fails with the status and the login URL
      And no captured output carries the password

    @integration
    Scenario: A missing secret names the secret the project has to hold
      Given the project holds no ACME_LOGIN_URL secret
      When the row runs
      Then the row fails and names ACME_LOGIN_URL
      And the row does not log in
