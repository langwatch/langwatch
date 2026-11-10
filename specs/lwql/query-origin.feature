Feature: A failed LangWatchQL query is told apart by who wrote it

  As the on-call engineer
  I want a failed built-in widget statement to raise an error and a user's typo not to
  So that a broken stock widget alerts us and customer mistakes only count

  A statement is built in when its sha256 hash is on the generated, grow-only list of stock
  statements. The origin is never sent by a caller and never decided by the error code.
  The one thing that is decided apart from the text is whether a statement failed at all: a
  refusal of the caller's own access, or of the parameter values the caller sent, is not a
  failure of the statement (see its rule below). Access is read from the violations and the view
  lists, never from the error code alone; parameter values from the refusal's code.

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
    Scenario: A new stock version is named newest and the oldest stays oldest
      Given the generated list names its covered commits newest first
      When the list is regenerated after a newer stock version is committed
      Then the new commit is first and the oldest commit is unchanged

    @unit
    Scenario: Removing a hash from the list fails the check
      Given the committed baseline of hashes the list has held
      When any one of them is taken off the generated list
      Then the check names it as missing
      # Limit: it cannot see a hash that was never pinned, nor a baseline edited with the list.

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
      Then the error line names the origin as built in and its fixed source label
      And the error line carries only the origin, the error code, the project id and the source
      And it carries no statement hash and no statement text

  Rule: Only the statement failing is reported; a refused request input is not

    A refusal of the caller's own access (every violation names a permission the caller lacks,
    or a view a gate they lack would show) is about the caller, not the statement text: it is decided
    from the parsed statement but writes no built-in line and is not counted, on either path.
    A refusal cut off at the violation cap is not that: the list may hide other reasons, so it
    is reported and counted.
    A refusal of the request's own projects, or of a reserved parameter name it supplies, is
    not the statement failing: it is refused before the report, writes no built-in line and is
    not counted. A refusal of the parameter values the caller sent (a parameter or time window
    left out, a step too fine for the window, a value of the wrong type, a reserved name supplied) is not either, though it
    is decided inside: on the workbench path it writes no built-in line and is not counted, for
    a built-in and a user-written statement alike. Otherwise anyone could paste stock text, leave
    out the window and page on-call. The server-written path sends its own values, so a parameter
    refusal there is still reported. The statement's own failures (parse, policy, execution,
    busy, timeout) are reported.

    @unit
    Scenario: A refused project scope writes no built-in failure
      Given a stock statement is sent naming a project the caller may not read
      When the workbench door refuses the projects
      Then no error-level record is written
      And the failure count does not rise

    @unit
    Scenario: A caller's own access refusal is neither reported nor counted
      Given a statement is refused because of the caller's own access, either a field whose
        permission the caller lacks (a stock widget reading a cost column without cost:view) or
        a view the full catalogue holds that the caller's protections hide (the gateway probe
        without gatewayUsage:view)
      When the failure reaches either report path, the workbench door or the server-written one
      Then no error-level record is written
      And the failure count does not rise, for a built-in and for a user-written statement alike
      And the member receives exactly the refusal they received before, with no extra field
      # Every violation must be of that kind. A view the catalogue lacks, or a table chosen by a
      # bound parameter, is refused for anyone: it stays reported, alone or beside a hidden view.

    @unit
    Scenario: A view no caller could see is reported
      Given a built-in statement names a view the view list holds but the catalogue has no
        entry for, so no grant would show it
      When the failure reaches either report path
      Then one built-in failure is reported and counted, because no gate the caller lacks would
        show that view

    @unit
    Scenario: A full grant shows every real view
      Given a caller holds every permission and content gate the catalogue names
      When the views they can reach are listed
      Then every view of the real view catalogue is in the list

    @unit
    Scenario: A view behind a permission the caller lacks reads as hidden
      Given a caller holds every grant but the permission a real view's table needs
      When the views a full grant shows are compared with the views this caller can reach
      Then that view is among the hidden ones

    @unit
    Scenario: A refusal cut off at the violation cap is reported
      Given a refusal holds as many access violations as the cap
      When the failure reaches either report path
      Then one built-in failure is reported and counted, because the list may hide other reasons

    @unit
    Scenario: A built-in failure that is not an access refusal is still reported
      Given a built-in statement is refused with no gate named, or names a view the catalogue lacks
      When the failure is reported
      Then one built-in failure is reported and counted

    @unit
    Scenario: A wrapped access refusal is reported and counted
      Given a caller's own access refusal is wrapped in another error as its cause
      When the wrapper reaches either report path
      Then the wrapper is not an access refusal, so one built-in failure is reported and counted per path
      And the unwrapped refusal is still skipped

    @unit
    Scenario: A refusal of the caller's own parameter values is neither reported nor counted
      Given a stock statement is sent on the workbench door without its time window, with a step
        too fine for its window, with a value of the wrong type, or with a reserved parameter name supplied
      When the request is refused for those values
      Then no error-level record is written
      And the failure count does not rise, for a built-in and for a user-written statement alike
      And the server-written path, whose values the server sent, still reports such a refusal

    @unit
    Scenario: A statement failure still writes the built-in failure
      Given a stock statement is sent with an accepted project scope and its time window
      When the statement fails for a reason of its own, such as a column the view lacks
      Then one built-in failure is reported

  Rule: A reserved parameter name is refused before the report

    @unit
    Scenario: A reserved parameter name supplied writes no built-in failure
      Given a stock statement is sent with a value for a reserved surface parameter name
      When the workbench door refuses it
      Then no error-level record is written
      And the failure count does not rise

    @unit
    Scenario: A reserved name is refused before the statement text is read
      Given a request that supplies a reserved name and whose statement text is also broken
      When the workbench door answers
      Then it answers the reserved-name refusal and reports nothing

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
    Scenario: REST, hydration, instant evals and saved chart runs are not reported or counted
      Given a failure on any path other than the tRPC door and the source presence probe
      Then no hash is compared
      And no error-level record is written
      And the failure count does not rise
