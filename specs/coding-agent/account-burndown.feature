Feature: Subscription account burndown
  A person who runs coding agents on a few subscription logins (for example three
  Claude Max accounts shared by many agents) wants to see, per account, what it
  spent this week and how close it is to its limit, as the provider reported it.

  The provider publishes no token allowance for these plans, so LangWatch never
  derives a percent from tokens: it shows only the percent, window and reset the
  account itself reported.

  Background:
    Given coding-agent sessions whose telemetry names the account they ran on

  @unit
  Scenario: the account attributes on a record become session facts
    Given a model call record carrying the langwatch.account attributes
    When its facts are lifted
    Then the account id, name, source, usage percent, window, reset, read time and limit are kept

  @unit
  Scenario: a launcher sets the account once on the resource
    Given the account attributes arrive through OTEL_RESOURCE_ATTRIBUTES
    And the record itself sets a different account name
    When its facts are lifted
    Then the resource fills the attributes the record left unset
    And the record's own value wins

  @unit
  Scenario: the account key falls back to the agent's own account id
    Given a record with no langwatch.account.id
    When its row is written
    Then the account is the agent's user.account_uuid, else its user.account_id

  @unit
  Scenario: an email address never names the account
    Given a record that carries only user.email
    When its row is written
    Then the row has no account

  @unit
  Scenario: an account with no name is shown by a short form of its id
    Given an account whose owner never set a name
    When the week is read
    Then the account is called "Account" followed by the first eight characters of its id

  @unit @integration
  Scenario: the reading is the newest one the account reported
    Given an account that reported 40 percent and later 72 percent
    And the later reading says it is no longer out of usage
    When the week is read
    Then the account shows 72 percent, its window, its reset and when it was read
    And it is not shown as out of usage

  @unit @integration
  Scenario: no percent is shown when none was reported
    Given an account whose rows carry no usage percent
    When the week is read
    Then the account has no percent
    And its card says no usage figure was reported

  @integration
  Scenario: an account out of usage says until when
    Given an account that reported it is out of usage until a later time
    When the person opens the usage page
    Then the account's card says "Out of usage until" that time

  @unit @integration
  Scenario: the week shows tokens and cost per day
    Given model calls on an account over the last seven days
    When the week is read
    Then each UTC day carries its input, output, cache read and cache write tokens and its cost
    And the card shows the cumulative tokens of the week, its total tokens and its cost
    And the cost is left out for a viewer who may not see costs

  @unit @integration
  Scenario: each account says which agents ran on it
    Given Claude Code and Codex sessions on the same account
    When the week is read
    Then the account lists both agents and its top models

  @integration
  Scenario: a viewer only sees accounts of the project they may read
    Given accounts used in two projects
    When a viewer reads one project's week
    Then only that project's accounts and figures are returned

  @integration
  Scenario: an aggregate project shows the accounts of its member projects
    Given an aggregate project whose members recorded sessions on different accounts
    When a viewer reads the aggregate's week
    Then the accounts of every member project are shown, the same projects as the sessions list

  @integration
  Scenario: sessions sent with a project key show their accounts
    Given sessions that a launcher sent with a project ingestion key and no user
    When the project's usage is read
    Then their accounts are shown like any other

  @integration
  Scenario: no subscription accounts yet
    Given no session this week named an account
    When the person opens the usage page
    Then the subscription accounts section says none were reported and links the docs
