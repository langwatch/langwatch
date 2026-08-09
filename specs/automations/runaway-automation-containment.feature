Feature: Runaway automations are contained without punishing the customer
  As a customer
  I want a busy automation to be throttled rather than silently broken
  So that one noisy condition costs me a day of extra matches, not my pipeline

  # WHAT THIS IS FOR. An automation that matches a large share of a project's
  # traffic produces real work: dataset rows, annotation-queue items, and the
  # bookkeeping behind them. One customer's two triggers produced roughly 300k
  # process-manager rows in a single day and about two annotation items of
  # actual output. Nothing bounded that, because the existing caps only ever
  # covered email (ADR-031) and webhooks.
  #
  # THE BLAME SPLIT IS THE WHOLE DESIGN. Two very different volumes get
  # conflated when you just count rows, and only one of them is the customer's:
  #
  #   CUSTOMER-ATTRIBUTABLE  a CONFIRMED persist dispatch. The filter genuinely
  #                          matched the settled trace and a dataset row or
  #                          annotation item is about to be created. This is
  #                          the only thing the ceiling, the email and the pause
  #                          may ever count.
  #
  #   OUR-ATTRIBUTABLE       match records, unconfirmed matches, debounce-bucket
  #                          fan-out, overflow flushes and outbox retries. Our
  #                          pipeline records a match for every active trigger
  #                          on every trace and only evaluates filters later, so
  #                          this volume is a multiplier WE chose. It is never
  #                          capped and never shown to the customer. It goes to
  #                          team metrics, because if our amplification is the
  #                          problem it should press us to fix it, not pause
  #                          them.
  #
  # THE CEILING IS RATE LIMITING, NOT PUNISHMENT. Over the ceiling, further
  # actions for that trigger are skipped for the rest of the UTC day and the
  # trigger keeps running. It works again tomorrow. Pausing is reserved for the
  # narrow shape where the automation is genuinely misconfigured rather than
  # merely busy.

  Background:
    Given a project with an active automation that adds matched traces to a dataset

  Rule: Only confirmed customer-facing work counts toward the ceiling

    @unit
    Scenario: A confirmed persist dispatch consumes a ceiling slot
      Given a settled match whose filters still pass at dispatch time
      When the persist dispatch runs
      Then it consumes one slot of the trigger's daily ceiling

    @unit
    Scenario: A match that fails its filters at dispatch consumes nothing
      Given a settled match whose filters no longer pass at dispatch time
      When the persist dispatch runs
      Then no ceiling slot is consumed
      And no action is dispatched

    @unit
    Scenario: Recording a match consumes nothing
      Given a trace that causes match records for many active triggers
      When those matches are recorded
      Then no ceiling slot is consumed by recording them

    @unit
    Scenario: An outbox retry of the same dispatch does not consume a second slot
      Given a persist dispatch that already consumed a ceiling slot
      When the outbox retries that same dispatch
      Then the ceiling count is unchanged

  Rule: The ceiling is a per-trigger daily allowance that follows the plan

    @unit
    Scenario: A free plan gets the smallest daily ceiling
      Given a project on a free plan
      When its trigger's daily ceiling is resolved
      Then the ceiling is the free-tier allowance

    @unit
    Scenario: A paid plan gets the standard daily ceiling
      Given a project on a paid non-enterprise plan
      When its trigger's daily ceiling is resolved
      Then the ceiling is the paid-tier allowance

    @unit
    Scenario: An enterprise plan gets the largest daily ceiling
      Given a project on an enterprise plan
      When its trigger's daily ceiling is resolved
      Then the ceiling is the enterprise-tier allowance

    @unit
    Scenario: A contract can raise a single customer's ceiling
      Given a plan that carries its own persist-dispatch allowance
      When its trigger's daily ceiling is resolved
      Then the contract allowance wins over the plan tier default

    @unit
    Scenario: The ceiling resets at the start of the next UTC day
      Given a trigger that used its whole ceiling yesterday
      When a match is dispatched after the UTC day rolls over
      Then the dispatch is allowed

  Rule: At the ceiling the automation is throttled, not broken

    @unit
    Scenario: A dispatch over the ceiling is dropped without an error
      Given a trigger that has reached its daily ceiling
      When another confirmed match dispatches
      Then no action is dispatched for it
      And the dispatch completes rather than retrying

    @integration
    Scenario: A throttled automation stays active
      Given a trigger that has reached its daily ceiling
      When another confirmed match dispatches
      Then the trigger is still active
      And it will dispatch again tomorrow

    @unit
    Scenario: Skipped matches are counted so the customer can see them
      Given a trigger past its daily ceiling
      When further confirmed matches are dropped
      Then the number of skipped matches for today is readable

    @integration
    Scenario: The automations list shows what was skipped today
      Given a trigger that skipped matches today
      When the customer opens the automations list
      Then the trigger shows how many matches it skipped today

    @integration
    Scenario: The customer is emailed once on the first day a trigger breaches
      Given a trigger that has just crossed its daily ceiling for the first time today
      When further matches breach the ceiling that same day
      Then exactly one breach email is sent for that trigger that day
      And it tells the customer to narrow the condition or raise the plan

    @unit
    Scenario: A breach raises a team metric rather than only a customer email
      Given a trigger that crosses its daily ceiling
      When the breach is handled
      Then the breach is counted on a team metric

  Rule: Pausing is reserved for automations that are actually misconfigured

    @integration
    Scenario: A busy but selective automation is never paused
      Given a trigger over its ceiling whose matches are a small share of project traffic
      When the breach is handled
      Then the trigger stays active
      And no pause email is sent

    @integration
    Scenario: An automation matching nearly all traffic is paused
      Given a trigger over its ceiling whose confirmed matches cover almost all of the project's traces
      When the breach is handled
      Then the trigger is paused with a runaway-volume reason
      And the customer is emailed about the pause

    @integration
    Scenario: A grandfathered match-everything automation is paused on breach
      Given a trigger with no condition at all that predates the condition requirement
      When it crosses its daily ceiling
      Then the trigger is paused with a runaway-volume reason

    @integration
    Scenario: A paused automation stops recording matches
      Given a trigger paused for runaway volume
      When new traces arrive for the project
      Then the trigger stops recording matches once its cache entry expires

    @integration
    Scenario: Resuming a paused automation clears the pause reason
      Given a trigger paused for runaway volume
      When the customer re-enables it
      Then the pause reason and pause time are cleared

  Rule: Our own amplification is never charged to the customer

    @unit
    Scenario: Match-record volume is measured for the team, not capped
      Given a trace that produces match records for every active trigger
      When those records are written
      Then a team metric counts them
      And no customer-facing limit is consulted

    @unit
    Scenario: A containment failure never breaks the dispatch it was watching
      Given the containment path fails while handling a breach
      When the persist dispatch completes
      Then the dispatch is not retried because of the containment failure
