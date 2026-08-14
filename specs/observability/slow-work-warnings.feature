Feature: A slow database query or a slow API call names itself in the log

  Work that succeeds slowly is the hardest kind to find. A failure leaves an
  error record with a stack. A query that takes four seconds and then returns
  the right answer leaves the same info line as one that took three
  milliseconds, so nobody sees it until a customer reports that a screen feels
  broken.

  That is what happened to the scenario editor. Every record on the path was
  healthy, every log line said the call succeeded, and the only signal was a
  person saying the form stayed empty for a few seconds.

  So a call that takes longer than its budget says so in its own record. The
  level is warning, which in this repo means watched by rate and not woken up
  for. It is not an error: the work completed and the answer was correct.

  There is a reason this did not exist already. The ClickHouse client used to
  warn per query and was removed in #6114 because it flooded the logs: it
  warned on response size against a global 3MB default, so every legitimately
  large read produced a line. The lesson taken from that is not "do not
  measure". It is that an unthrottled per-query warning on a busy datastore
  produces noise instead of signal. Both warnings below are therefore
  throttled per identity, and every warning states how many it stands for.

  # ---------------------------------------------------------------------------
  # Postgres queries
  # ---------------------------------------------------------------------------

  Rule: A Postgres query slower than its budget leaves a warning

    @unit
    Scenario: A query inside the budget is not warned about
      Given the slow query budget is 500 milliseconds
      When a query takes 20 milliseconds
      Then no warning is logged

    @unit
    Scenario: A query over the budget is warned about
      Given the slow query budget is 500 milliseconds
      When a query takes 900 milliseconds
      Then a warning is logged
      And the warning names the model and the operation
      And the warning states the duration and the budget

    @unit
    Scenario: A failing query is left to the caller to report
      Given the slow query budget is 500 milliseconds
      When a query takes 900 milliseconds and then throws
      Then no warning is logged
      And the error reaches the caller unchanged

  Rule: A warning never carries query arguments

    The arguments hold customer data: identifiers, names, message bodies,
    whatever a filter was built from. The names of the argument keys say what
    shape the query was without saying what was in it, which is the same rule
    the ClickHouse client follows with paramKeys.

    @unit
    Scenario: Argument values are not logged
      Given the slow query budget is 500 milliseconds
      When a slow query filters on a customer email address
      Then the warning does not contain the email address
      And the warning lists the argument keys

    @unit
    Scenario: A raw query does not log its SQL
      Given the slow query budget is 500 milliseconds
      When a slow raw query runs
      Then the warning names the operation as raw
      And the warning does not contain the SQL text

  Rule: Repeated slow queries are throttled

    A query that has become slow is usually slow on every call. Warning on
    each one buries every other line in the log, which is how the ClickHouse
    warning earned its removal.

    @unit
    Scenario: The same slow query warns once per interval
      Given the slow query budget is 500 milliseconds
      And the throttle interval is 60 seconds
      When the same model and operation runs slowly 50 times inside the interval
      Then one warning is logged

    @unit
    Scenario: A throttled warning states how many calls it stands for
      Given the slow query budget is 500 milliseconds
      And the throttle interval is 60 seconds
      When the same model and operation runs slowly 50 times inside the interval
      And the interval elapses
      And it runs slowly once more
      Then the next warning states the number of calls it suppressed

    @unit
    Scenario: A different query is not throttled by its neighbour
      Given the slow query budget is 500 milliseconds
      And the throttle interval is 60 seconds
      When two different models each run slowly once inside the interval
      Then two warnings are logged

  # ---------------------------------------------------------------------------
  # API calls
  #
  # The Postgres warning above would not have found the scenario editor
  # regression: every Postgres query on that path was fast. The call that was
  # slow was an API procedure whose own work was in ClickHouse, and the record
  # for it already carried the duration and still logged at info.
  # ---------------------------------------------------------------------------

  Rule: An API call slower than its budget leaves a warning

    @unit
    Scenario: A call inside the budget stays at info
      Given the slow call budget is 3000 milliseconds
      When a call succeeds in 42 milliseconds
      Then the record is logged at info level

    @unit
    Scenario: A call over the budget is raised to warning
      Given the slow call budget is 3000 milliseconds
      When a call succeeds in 9000 milliseconds
      Then the record is logged at warning level
      And the record names the procedure path
      And the record states the duration and the budget

    @unit
    Scenario: A failed slow call keeps the level its failure earned
      Given the slow call budget is 3000 milliseconds
      When a call fails in 9000 milliseconds with a platform fault
      Then the record is logged at error level

    # Presence heartbeats are silenced by path before the record is built, so a
    # slow one raises nothing. That is deliberate: they fire every few seconds
    # per open tab, and a degraded server would turn the warning into the flood
    # it exists to avoid.
    @unit
    Scenario: A silenced path stays silent even when slow
      Given the slow call budget is 3000 milliseconds
      When a presence heartbeat succeeds in 9000 milliseconds
      Then the path is classified as silenced
      And an ordinary path is not
