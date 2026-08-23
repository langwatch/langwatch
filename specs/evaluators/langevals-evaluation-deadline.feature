Feature: A stuck evaluation cannot take the evaluation service down with it

  The evaluation service bounds how many evaluations run at once. A request
  takes a slot when it is admitted and gives it back when its batch returns.

  An evaluation waits on a model call over the network, and that call can
  stall for as long as the provider leaves the socket open. A request that
  never returns therefore keeps its slot for the life of the process. Enough
  of them and no request is ever admitted again: every caller waits out the
  queue and is told the evaluation queue is full, including callers whose work
  would have taken a second. Nothing reclaims the slots, so the process stays
  in that state until it is restarted.

  Two bounds stop it. One model call may not run longer than the model
  timeout, and one request may not hold its slot longer than the evaluation
  timeout. Work that overruns is abandoned and reported, never waited on.

  Rule: A slot always comes back

    @unit
    Scenario: A stuck evaluation gives its gate slot back
      Given the only slot is held by an evaluation that never finishes
      When the evaluation runs past the evaluation timeout
      Then the slot is free again
      And the next request is served instead of queueing behind stuck work

    @unit
    Scenario: An entry that ran out of time is reported as an error
      Given an evaluation that never finishes
      When its batch runs past the evaluation timeout
      Then the entry is answered as an error naming the timeout
      And the caller gets an answer rather than a hang

    @unit
    Scenario: A batch that finishes in time is untouched
      Given an evaluation that finishes well inside the evaluation timeout
      When the batch runs
      Then the entry carries its real result

    @unit
    Scenario: A slot comes back before the caller queued behind it gives up
      Given an evaluation holding the only slot for as long as the deadline allows
      When a caller queues for that slot
      Then the slot comes back while the caller is still waiting

  Rule: An answer says where to look

    A stalled model call and an abandoned batch both return the slot, so the
    difference the caller sees is which one is named. The model call has to
    give up first for the answer to point at the provider.

    @unit
    Scenario: A stalled model call is answered as a provider timeout
      Given a model call that stops making progress
      When it runs past the model timeout
      Then the entry is answered as a model-call timeout
      And the answer is not the batch reporting that it gave up

    @unit
    Scenario: A stalled model call runs out of attempts before the batch gives up
      Given a model call that stops making progress on every attempt
      When the entry retries it as many times as it is allowed
      Then every attempt and every wait between them fits inside the evaluation timeout

  Rule: One endpoint calls every evaluator

    An evaluator that batches differently may replace the batch method. A
    replacement that accepts fewer arguments still imports and still loads,
    and fails only when a customer calls that one evaluator. A replacement
    that accepts the deadline and ignores it loads and runs, and holds its
    slot past the deadline the same way an unbounded call always did.

    @unit
    Scenario: Every evaluator accepts the arguments the server calls it with
      Given every evaluator the server loaded
      When the server's own call is bound against each batch method
      Then every evaluator accepts it

    @unit
    Scenario: An evaluator that batches its own way still stops at the deadline
      Given an evaluator that answers the whole batch at once
      And a provider that stops making progress
      When the batch runs past the evaluation timeout
      Then every entry is answered as an error naming the timeout
      And the call is given up on rather than waited out
