Feature: A slow database query or a slow API call names itself in the log

  Work that succeeds slowly is the hardest kind to find. A failure leaves an
  error record with a stack. A query that takes four seconds and then returns
  the right answer leaves the same info line as one that took three
  milliseconds, so it goes unseen until a customer reports that a screen
  feels broken.

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
      When a query finishes inside its budget
      Then no warning is logged

    @unit
    Scenario: A query over the budget is warned about
      When a query takes longer than its budget
      Then a warning is logged
      And the warning names the model and the operation
      And the warning states the duration and the budget

    @unit
    Scenario: A failing query is left to the caller to report
      When a query runs over its budget and then throws
      Then no warning is logged
      And the error reaches the caller unchanged

  Rule: A warning never carries query arguments

    The arguments hold customer data: identifiers, names, message bodies,
    whatever a filter was built from. The names of the argument keys say what
    shape the query was without saying what was in it, which is the same rule
    the ClickHouse client follows with paramKeys.

    @unit
    Scenario: Argument values are not logged
      When a slow query filters on a customer email address
      Then the warning does not contain the email address
      And the warning lists the argument keys

    @unit
    Scenario: A raw query does not log its SQL
      When a slow raw query runs
      Then the warning names the operation as raw
      And the warning does not contain the SQL text

  Rule: Repeated slow queries are throttled

    A query that has become slow is usually slow on every call. Warning on
    each one buries every other line in the log, which is how the ClickHouse
    warning earned its removal.

    @unit
    Scenario: The same slow query warns once per interval
      When the same model and operation runs slowly many times inside one interval
      Then one warning is logged

    @unit
    Scenario: A throttled warning states how many calls it stands for
      When the same model and operation runs slowly many times inside one interval
      And the interval elapses
      And it runs slowly once more
      Then the next warning states the number of calls it suppressed

    @unit
    Scenario: A different query is not throttled by its neighbour
      When two different models each run slowly once inside one interval
      Then two warnings are logged

  # ---------------------------------------------------------------------------
  # API calls
  #
  # The scenario editor regression turned out to be a Postgres query (the
  # prompt list aggregated a whole table per call), which the warning above
  # names directly. This half covers the calls whose slow work is somewhere
  # else: a ClickHouse read, a provider call, serialization. The procedure
  # record is also the only one that carries the full duration of the call.
  # ---------------------------------------------------------------------------

  Rule: An API call slower than its budget leaves a warning

    @unit
    Scenario: A call inside the budget stays at info
      When a call succeeds inside its budget
      Then the record is logged at info level

    @unit
    Scenario: A call over the budget is raised to warning
      When a call succeeds over its budget
      Then the record is logged at warning level
      And the record names the procedure path
      And the record states the duration and the budget

    @unit
    Scenario: A failed slow call keeps the level its failure earned
      When a call fails over its budget with a platform fault
      Then the record is logged at error level

    # Presence heartbeats say nothing on the happy path however long they take.
    # That is deliberate: they fire every few seconds per open tab, so a
    # degraded server would turn this warning into the flood it exists to
    # avoid. A heartbeat that fails is still reported, because the volume that
    # earns the silence is happy-path volume.
    @unit
    Scenario: A silenced path stays silent even when slow
      When a presence heartbeat succeeds over its budget
      Then nothing is logged for it
      But an ordinary call of the same duration is warned about

    @unit
    Scenario: A silenced path still reports its failures
      When a presence heartbeat fails
      Then the failure is logged
