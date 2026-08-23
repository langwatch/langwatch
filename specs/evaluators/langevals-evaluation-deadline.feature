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
    Scenario: The evaluation deadline is shorter than the queue a caller waits in
      Given the two timeouts the service is configured with
      When they are compared
      Then a slot comes back before the callers queued behind it give up

    @unit
    Scenario: A model call fails before the batch gives up on it
      Given a model call that stops making progress
      When it runs past the model timeout
      Then it fails as a provider timeout, which names the provider
      And the batch deadline stays the backstop behind it

  Rule: One endpoint calls every evaluator

    An evaluator that batches differently may replace the batch method. A
    replacement that accepts fewer arguments still imports and still loads,
    and fails only when a customer calls that one evaluator.

    @unit
    Scenario: Every evaluator accepts the arguments the server calls it with
      Given every evaluator the server loaded
      When the server's own call is bound against each batch method
      Then every evaluator accepts it
