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

    # The claim and the counter are read and written by one Lua script, and a
    # clustered Redis rejects a multi-key script whose keys land in different
    # slots. That rejection is indistinguishable from any other Redis error, so
    # it would be answered by falling back to per-worker counting: the ceiling
    # would still appear to work while no longer being shared.
    @unit
    Scenario: The ceiling survives a clustered Redis
      Given a trigger whose claim and day counter are used in one script
      When their Redis Cluster slots are compared
      Then both keys carry the same hash tag

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

    # The fallback ceiling is generous against the free tier and mean against
    # the enterprise one, where it is a tenth of the real allowance and every
    # match above it is dropped for good. Caching it would turn one failed read
    # into a whole cache window of an enterprise account quietly losing most of
    # its automation output.
    @unit
    Scenario: A ceiling that could not be resolved is not remembered
      Given a project whose plan cannot be read
      When its ceiling is resolved again after the plan becomes readable
      Then the second resolution returns the plan's real ceiling

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

    # The list renders every automation in the project, so the status behind it
    # covers every automation too. Reading a caller-supplied slice instead is
    # what made the badge disappear past whatever size that slice was capped at,
    # which lands on exactly the projects with enough automations to need it.
    @integration
    Scenario: Every automation on the list reports what it skipped
      Given a project with more automations than one request used to carry
      And one of the later ones passed its ceiling today
      When the automations list reads the daily cap status
      Then that automation still reports its skipped count

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

    # The claim that makes the mail once-only carries the whole day, so taking
    # it and then failing to send costs the customer the single message that
    # explains why their automation stopped producing records. The claim is
    # given back on a failed send, and the containment rate limit in front of it
    # means a persistently broken mailer retries at one attempt per minute
    # rather than storming.
    @integration
    Scenario: A limit email that could not be sent is tried again
      Given a trigger over its ceiling whose limit email fails to send
      When another match breaches after the evaluation window
      Then the email is attempted again
      And it is still sent only once for the day after it lands

    # Every skipped match lands in containment, and the pause decision costs a
    # ClickHouse distinct-count over 24h of project traffic. The storm is
    # absorbed by a short claim BEFORE that query: one evaluation per trigger
    # per window, re-examined through the day as traffic moves.
    @integration
    Scenario: A breach storm measures the project's traffic once per window
      Given a trigger whose matches keep breaching its ceiling
      When containment handles the storm of breaches
      Then the project's traffic is measured once for the whole window

    @integration
    Scenario: A breach raises a team metric rather than only a customer email
      Given a trigger that crosses its daily ceiling
      When the breach is handled
      Then the breach is counted on a team metric

    # The mail asks the customer to narrow the condition, so its link has to
    # land somewhere that can. The legacy structured-filter drawer cannot edit
    # a query-based condition at all, which made the ask unactionable for
    # exactly the automations most likely to run away.
    @unit
    Scenario: The limit email links to a drawer that can edit the condition
      Given a trigger whose condition is a search query
      When the limit email is addressed
      Then its link opens the automation authoring drawer on that automation

    # An admin who unsubscribed from this project's automation mail (ADR-031)
    # is not mailed about its limits either. The suppression list is read over
    # the network, and failing to read it must not swallow the one mail that
    # explains why an automation stopped producing records.
    @unit
    Scenario: An unsubscribed admin is not mailed about a limit
      Given an org admin who unsubscribed from this project's automations
      When the limit email is addressed
      Then that admin is not among the recipients

    # The recipients are independent sends, so one unroutable address must not
    # decide that the rest of the organization hears nothing. Only a batch where
    # nothing landed is worth reporting upward, because the caller answers that
    # by trying again.
    @unit
    Scenario: One undeliverable admin does not silence the others
      Given a limit email whose recipients include one bad address
      When the mail is sent
      Then the other recipients still receive it
      And the send is not reported as failed

    @unit
    Scenario: A limit email nobody received is reported as failed
      Given a limit email that no recipient could be delivered
      When the mail is sent
      Then the send is reported as failed

    # A mail provider quotes the envelope back in its rejection, so the failure
    # text carries the admin's address. The failure is reported by its code,
    # which is the part an operator acts on and names nobody.
    @unit
    Scenario: A failed limit email is reported without quoting the provider
      Given a limit email the provider rejected with the recipient in the message
      When the failure is reported
      Then it names the provider's failure code
      And it does not carry the recipient's address

    # Releasing by key alone crosses workers. A worker that claimed while Redis
    # was unreachable, and whose send fails only after the fleet moved on, would
    # otherwise drop the claim the worker that did mail is holding, and the next
    # breach would mail the customer a second time.
    @unit
    Scenario: A stale claim release never frees another worker's claim
      Given a worker holding a claim another worker has since retaken
      When that worker releases its claim
      Then the current holder keeps it
      And no second limit email is sent

    @unit
    Scenario: An unreadable suppression list still lets the mail out
      Given the suppression list cannot be read
      When the limit email is addressed
      Then every org admin is still a recipient

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
      Then the trigger stops recording matches immediately, without waiting for its cache entry to expire

    @integration
    Scenario: Resuming a paused automation clears the pause reason
      Given a trigger paused for runaway volume
      When the customer re-enables it
      Then the pause reason and pause time are cleared

    # The pause is a database write, so it can fail. The once-only gate that
    # keeps a storm of breaches from writing the pause thousands of times must
    # not also turn one failed write into a whole day of running unpaused.
    @integration
    Scenario: A failed pause is retried rather than claimed away
      Given an automation that qualifies for a pause
      And the pause write fails
      When another breach arrives after the attempt gate expires
      Then the pause is attempted again
      And no pause email is sent for the attempt that never landed

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
