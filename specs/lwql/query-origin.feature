Feature: A failed LangWatchQL query is told apart by who wrote it

  As the on-call engineer
  I want a failed built-in widget statement to raise an error and a user's typo not to
  So that a broken stock widget alerts us and customer mistakes only count

  A statement is built in when its sha256 hash is on the generated, grow-only list of stock
  statements. The origin is never sent by a caller and never decided by the error code.

  Rule: The built-in list is generated from the stock statements and only ever grows

    @unit
    Scenario: Every current stock statement is on the list
      Given the committed copy of the stock widget statements, as a saved widget sends them
      When each statement is hashed as written
      Then every hash is on the generated list

    @unit
    Scenario: The list says what it covers
      Given the generated list
      Then its header states how many stock statement versions it covers and from which oldest commit

    @unit
    Scenario: A statement edited by one character is user-written
      Given a stock statement with one character changed
      When its origin is read
      Then it is user-written

    @unit
    Scenario: A hand-pasted copy of a stock statement counts as built in
      Given the exact text of a stock statement typed into the workbench
      When its origin is read
      Then it is built in, which is a known limit: the list knows text, not authors

  Rule: A built-in failure writes one error line with no statement text

    @unit
    Scenario Outline: A built-in failure is an error whatever the code
      Given a built-in statement fails with the error code <code>, a handled code such as
        lwql_invalid_query where the executor translated it, or the engine's own where it did not
      When the failure is reported
      Then one error-level record is written
      And the call carries only the origin, the error code, the project id and the statement hash
      And the logger's request context may add its own fields, such as the trace and organisation ids

      Examples:
        | code |
        | 47   |
        | 215  |
        | 999  |

    @unit
    Scenario: The error line carries neither the statement nor its parameter values
      Given a built-in statement and a parameter value, each with a recognisable marker
      And an error whose message and nested cause echo both
      When the failure is reported
      Then neither marker appears anywhere in the serialized record

    @unit
    Scenario: A built-in failure outside the workbench carries no hash
      Given the source presence probe, whose statements are fixed constants
      When one of its statements fails
      Then the error line names the origin as built in and carries no statement hash

  Rule: Only the statement failing is reported; a refused request input is not

    A refusal of the request's own projects is not the statement failing, so it writes no
    built-in line and is not counted. The statement's own failures (parse, policy, parameters
    it declares, execution, busy, timeout) are reported. Parameter and time-window checks run
    inside statement validation, after the statement is parsed, so they cannot be split off by
    stage and count with the statement.

    @unit
    Scenario: A refused project scope writes no built-in failure
      Given a stock statement is sent naming a project the caller may not read
      When the workbench door refuses the projects
      Then no error-level record is written
      And the failure count does not rise

    @unit
    Scenario: A statement failure still writes the built-in failure
      Given a stock statement is sent with an accepted project scope
      When the statement fails
      Then one built-in failure is reported

  Rule: A user-written failure is counted and writes no error line

    @unit
    Scenario: A user-written failure increments the failure count for its origin
      Given a statement that is not on the list fails
      When the failure is reported
      Then the failure count for origin user_written rises by one
      And no error-level record is written

  Rule: Only the workbench door decides the origin, from the statement it was sent

    @unit
    Scenario: A failed query on the tRPC door is reported with the statement exactly as sent
      Given a member runs a statement on analytics.lwql.query and it fails
      When the door answers
      Then the failure is reported with the project id and the statement exactly as sent
      And the member still receives the same error, so the request log and its fault rule are unchanged

    @unit
    Scenario: A successful query is not reported
      Given a member runs a statement on analytics.lwql.query and it succeeds
      Then no failure is reported

    @unit
    Scenario: The caller cannot name the origin
      Given a member sends an origin with the query request
      When the door reports a failure
      Then the report carries no origin from the request

    @integration @unimplemented
    Scenario: REST, hydration, instant evals and saved chart runs are always user-written
      Given a failure on any path other than the tRPC door and the source presence probe
      Then no hash is compared and the failure is user-written
