Feature: What an operator can see about trace ingestion from either process

  Two processes will ingest traces while the conversion runs, and they export
  metrics differently: the application increments a Prometheus registry it owns,
  and a process composed from packages pushes over OTLP. A dashboard that
  answers an operational question must not have to know which of them handled
  the trace, so both write the same series names with the same labels.

  Drift here is silent in the worst direction. A renamed series produces an
  empty panel, and an empty panel reads as "this never happens" — which for the
  evaluator loop guard means "we are not billing a customer for our own
  recursion" and for the trigger match counter means "the automations are
  quiet". Both are exactly the reading an operator would act on.

  @unit
  Scenario: A blocked evaluator dispatch is counted under its own reason
    Given an online-evaluator dispatch refused by a loop guard
    When the refusal is recorded
    Then the counter carries the guard's reason as its only label

  @unit
  Scenario: The loop-guard series keeps the name the application writes
    Given the loop-guard counter
    When its declaration is inspected
    Then the series name and help text are the application's

  @unit
  Scenario: Trigger match records are counted before any filter runs
    Given a trace that produced trigger match records
    When the count is recorded
    Then the counter advances by the number of records written

  @unit
  Scenario: A trace that matched nothing does not write a zero
    Given a trace that produced no trigger match records
    When the count is recorded
    Then nothing is written

  @unit
  Scenario: The trigger match series carries no per-project label
    Given the trigger match counter
    When a count is recorded
    Then the series carries no attributes
