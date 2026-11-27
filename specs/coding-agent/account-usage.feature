Feature: Subscription account usage in coding agent telemetry
  A person who runs coding agents on a few subscription logins (for example three
  Claude Max accounts shared by many agents) wants to chart, per account, what it
  spent and how close it is to its limit, in their own dashboard widgets.

  LangWatch stores the account each call ran on, plus the usage the account itself
  reported, on every model call and rate limit row of coding_agent_session_events.
  The coding_session_events LangWatchQL view exposes those columns, so a widget can
  group by them. LangWatch never derives a percent from tokens.

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
  Scenario: a window or read time alone is not stored as a reading
    Given a record that names a usage window and a read time but no percent, reset or limit
    When its row is written
    Then the row stores no window and no read time
    And an older full reading stays the newest one a query finds

  @unit
  Scenario: instants are stored in milliseconds whatever unit they were sent in
    Given a reset time sent in epoch seconds and a limit sent in epoch nanoseconds
    When their row is written
    Then both are stored as the same instants in milliseconds

  @unit
  Scenario: an instant no clock could mean is dropped, never failing the write
    Given a reset time in the year 9999 and a limit far past any real date
    When their row is written
    Then both are stored as empty
    And the rest of the row, its usage percent included, is written

  @integration
  Scenario: A dashboard widget groups the last 7 days by account
    Given model calls and rate limits on two accounts, one older than the week and one with no account
    When a widget's LangWatchQL query groups coding_session_events of the last 7 days by AccountId
    Then each account shows its tokens of the week, its rate limits, its newest name and its newest usage percent
    And rows older than the week or with no account are left out
