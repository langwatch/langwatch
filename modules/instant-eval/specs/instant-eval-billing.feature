Feature: Instant Evals are metered on the gateway spend spine, reported to Stripe, and free up to a budget

  As the platform
  I want every judged query and run recorded as one spend record, billed monthly, and free until a budget is spent
  So that the customer pays for what was judged, a project budget caps it, and a free organization can try it first

  Issue: Instant Evals, PR 5. ADR-153 §8.

  The shape:
  - One spend record per query or run on the same ledger the AI Gateway writes, `gateway_spend`,
    so the spend page, the budget debits and the billing meter read it with no new table.
  - The record is one confirmed outcome with no admission: the spine already accepts an outcome
    that states its own attribution, and a judgement has no in-flight phase to admit.
  - A run or a query sends its record through the Instant Evals judge, which prices it, and gateway
    writes the ledger row from the judge's priced fact (ADR-174 decision 13).
  - The customer price rides the record as its cost. Our own cost and the request count ride the
    metadata beside it, so the margin is recoverable without recomputing a rate that will change.
  - A Stripe meter, `langwatch_instant_eval_usd`, receives the month's price per organization.
  - An organization with no paid plan may spend one dollar on Instant Evals in total.

  Rule: A judged query or run is one spend record

    @unit
    Scenario: A finished run is one confirmed spend record addressed by the run
      Given a run that judged two thousand input tokens over forty rows
      When its spend is recorded
      Then one spend record is sent through the Instant Evals judge
      And its request id is the run's own id under the instant eval prefix
      And it carries the run's input tokens, its request count and the run

    @unit
    Scenario: A run's ledger row is written from the judge's priced record
      Given a run's spend the Instant Evals judge priced
      When gateway writes its ledger row
      Then its request type is instant_eval, its model is the classifier's and it names no virtual key
      And its input tokens are the run's and its cost is the customer price in nano dollars
      And its metadata carries our own cost, the request count and the run

    @unit
    Scenario: A synchronous query is one confirmed spend record with a fresh id
      Given a query that judged five hundred input tokens
      When its spend is recorded
      Then one spend record is sent through the Instant Evals judge with a fresh instant eval query id
      And it names no run

    @unit
    Scenario: A retried finish records the same request rather than a second one
      Given a run whose finish is delivered twice
      When its spend is recorded both times
      Then both outcomes carry the same request id
      # The spine keys its idempotency on the tenant, the request id and the
      # lifecycle step, so the second append is dropped by the event store.

    @unit
    Scenario: The record is billed against the project's organization and team
      Given a project of a team of an organization
      When a run's spend is recorded
      Then the outcome names that organization and that team
      # Which is what lets an organization or team gateway budget see it.

    @integration
    Scenario: A finished run lands one row on the spend ledger with the right amounts
      Given a run that judged input tokens
      When its spend is recorded and the outcome folds
      Then the ledger holds one confirmed row for the run
      And the row's cost is the customer price and its tokens are the run's

    @integration
    Scenario: A synchronous query lands one row on the spend ledger
      Given a query that judged input tokens
      When its spend is recorded and the outcome folds
      Then the ledger holds one confirmed row of request type instant_eval

    @unit
    Scenario: A record that cannot be dispatched is raised, not dropped
      Given an Instant Evals judge that cannot store the spend
      When a run's spend is recorded
      Then the failure is raised so the finish is delivered again

    @unit
    Scenario: A routed page that reports after its run finished is billed on its own
      Given a routed run that finished while one of its pages was still judging
      When that page reports its routed spend after the finish
      Then the page is billed on a spend record of its own, beside the run's record
      And only once the run's finish has landed, whichever reported first
      And its cost and price are added to the finished run's row
      So the row's cost and price always equal what the run's spend records bill
      And a late page that carries no routed spend changes nothing, as before the router

    @unit
    Scenario: A held late page is billed even when its run's finish never lands
      Given a routed run whose late page is held until the run's finish lands
      When the finish has not landed by the end of the hold
      Then the held page is billed on its own spend record without it
      And its amounts are logged at error, naming the run and the page
      And a finish that lands after all bills the page no second time
      And a run row update that fails after the page's spend is written is retried, then logged at error

  # ADR-174 decision 24. Rows that failed to judge are free unless a routed leg was already
  # paid for them (ADR-190 decision 3): the finish bills what the run's judged pages summed.
  Rule: A run that fails bills the pages it judged

    @unit
    Scenario: A run whose page fails on its last attempt bills the pages it judged
      Given a run whose first two pages were judged and recorded
      When its third page fails on its last attempt, or with an error the outbox will not retry
      Then the page's failure is recorded, and the run is not marked finished by the page itself
      And the run finishes as failed with the failure's code
      And the finish records one spend record for the tokens and cost the two judged pages summed
      And the run's free budget hold is released after that record
      And a failure that cannot be recorded leaves the run to the stall wake, which bills the same totals

    @unit
    Scenario: A run stopped by a budget between pages bills the pages judged before it
      Given a run whose judged pages took a blocking gateway budget to its limit
      When the next page is refused with instant_eval_gateway_budget_exceeded
      Then the run finishes as failed with instant_eval_gateway_budget_exceeded
      And the finish bills the tokens and cost of the pages judged before the stop

    @unit
    Scenario: A run that judged nothing before it failed costs nothing
      Given a run whose first page fails on its last attempt
      When the run finishes as failed
      Then the finish carries no tokens and no cost
      And no spend record is written, and the run's free budget hold is still released

    @unit
    Scenario: A failure delivered again is still one spend record
      Given a run whose page failure is recorded twice
      When both records reach the run
      Then both carry the same event key, so the second collapses
      And the run asks for one failed finish, under the run's one finish key
      And that finish records its spend under the run's own request id

  Rule: The spend page names the judged rows

    @unit
    Scenario: A spend row with no virtual key and the instant eval request type reads as Instant Evals
      Given a spend row of request type instant_eval
      When the spend page names its key
      Then it says Instant Evals rather than nothing

    @unit @integration
    Scenario: A spend row with no virtual key and the own decision model request type reads as Instant Evals on your own model
      Given a spend row of request type instant_eval_decision_model
      When the spend page names its key
      Then it says Instant Evals (own model) rather than nothing

  Rule: Instant Eval spend debits gateway budgets like any other spend

    @unit
    Scenario: A project budget sees an Instant Eval outcome
      Given an outcome with no virtual key and no provider
      When the debits process handles it
      Then it debits the organization, team and project budgets that apply
      # The debits process already takes an outcome that carries its own
      # attribution; the empty key and provider only narrow which budgets match.

  # The check is the gateway's own preflight for the project, under a key no
  # key budget names, so the organization, team and project budgets apply.
  # An own decision model is checked too: its provider usage is debited to the
  # same budgets (ADR-193).
  Rule: A gateway budget set to block stops Instant Evals

    @unit
    Scenario: A run is refused once a blocking budget is reached
      Given an organization on a paid plan whose project budget is set to block
      And the budget's spend is at its limit
      When a run is requested
      Then it is refused with instant_eval_gateway_budget_exceeded
      And the refusal names the budget, its scope, window, limit and spend
      And nothing is held or queued

    @unit
    Scenario: A budget set to warn never refuses a run
      Given an organization whose only reached budget is set to warn
      When a run is requested
      Then it is accepted

    @unit
    Scenario: A run under way stops between pages once its spend reaches a blocking budget
      Given a run whose judged rows have taken a blocking budget to its limit
      When the next page is asked for
      Then it is refused with instant_eval_gateway_budget_exceeded before anything is read
      And the check projects the run's own spend so far

    @unit
    Scenario: A judged query is refused once a blocking budget is reached
      Given a project whose blocking budget is at its limit
      When a statement calling an eval function is submitted
      Then it is refused with instant_eval_gateway_budget_exceeded before anything is held or judged

  Rule: The month's Instant Eval price is one Stripe meter per organization

    @unit
    Scenario: The meter is named langwatch_instant_eval_usd
      When the month's Instant Eval spend is reported
      Then the meter event is named langwatch_instant_eval_usd

    @unit
    Scenario: The value is the month's price in dollars to four places
      Given an organization whose Instant Eval spend this month is 12345678900 nano dollars
      And nothing reported yet
      When the month is reported
      Then the meter event's value is 12.3456

    @unit
    Scenario: A second report sends only the delta since the checkpoint
      Given a checkpoint that reported 1.0000 dollars
      And the month's spend is now 1.5000 dollars
      When the month is reported
      Then the meter event's value is 0.5000
      And its identifier names the meter, the month and both totals

    @unit
    Scenario: The Instant Eval meter keeps its own checkpoint
      Given an organization with billable events and Instant Eval spend in the same month
      When the month is reported
      Then each meter's checkpoint is written under its own name
      And the billable events identifier is unchanged from before the second meter existed

    @unit
    Scenario: The Instant Eval meter is reported only once Stripe holds it
      Given a Stripe mode whose catalog maps no Instant Evals meter yet
      And an organization with Instant Eval spend this month
      When the month is reported
      Then the events meter is reported as usual
      And no Instant Eval meter event is sent and its checkpoint is not advanced
      # Stripe accepts an event for a meter that does not exist and drops it
      # later, so reporting early would skip the usage for good. The first
      # report after the meter is mapped carries the month from zero.

    # Stripe bills a meter event no subscription line prices at nothing, so
    # sending it would advance the checkpoint and lose the charge (ADR-174 decision 18).
    @unit
    Scenario: Usage is held while the subscription carries no Instant Evals price
      Given a Stripe mode whose catalog maps the Instant Evals meter
      And an organization whose active Growth subscription in dollars has no Instant Evals price
      And Instant Eval spend this month
      When the month is reported
      Then no Instant Eval meter event is sent and its checkpoint is not advanced
      And no other report is scheduled for it
      And the billable events meter is reported as usual
      And a warning names the organization, the meter and the amount held

    @unit
    Scenario: A Growth subscription in euros holds its Instant Eval usage
      Given an organization whose active Growth subscription is in euros
      And Instant Eval spend this month
      When the month is reported
      Then no Instant Eval meter event is sent and its checkpoint is not advanced
      And the billable events meter is reported as usual
      # The price is in dollars and no euro price exists, so the month is held until one does.

    @unit
    Scenario: Usage is reported once the subscription carries the Instant Evals price
      Given an organization whose active subscription has the Instant Evals price
      And Instant Eval spend of 5.0428 dollars this month
      When the month is reported
      Then the Instant Eval meter event's value is 5.0428

    @unit
    Scenario: The first report after the Instant Evals price is added bills only from the line
      Given an organization whose usage was held for want of the Instant Evals price
      And it has no cancelled subscription whose line hands it an earlier start
      When the price is added to its subscription and the month is reported
      Then the spend is read from the moment the line was added, never the month's first day
      # Charges start from the moment the line is added; a cancelled line that ended with no gap
      # before it hands on its earlier start instead (ADR-174 decision 26).

    # Up to the free dollar used before upgrading never reaches the first invoice (ADR-174 decision 23, proposed in v22).
    @unit
    Scenario: Free use before an upgrade mid-month is not reported
      Given an organization whose usage-billed subscription started on the 10th of the month
      And Instant Eval spend both before and after the 10th
      When the month is reported
      Then the spend is read from the subscription's start to the month's end
      And the meter event carries only the spend since the upgrade

    @unit
    Scenario: A subscription older than the month reports the whole month
      Given an organization whose usage-billed subscription started before the month
      When the month is reported
      Then the spend is read from the month's start to the month's end

    @unit
    Scenario: A subscription with no recorded start reports the whole month
      Given an organization whose usage-billed subscription has no start date, or a connected account
      When the month is reported
      Then the spend is read from the month's start to the month's end

    @unit
    Scenario: A month that ended before the subscription started reports nothing
      Given an organization whose usage-billed subscription started after the month ended
      When that month is reported
      Then the spend read covers no time at all
      And no Instant Eval meter event is sent

    @unit
    Scenario: A month already reported is not lowered by the subscription window
      Given a checkpoint that reported 1.5000 dollars, free use before the upgrade included
      And the window from the subscription's start now reads 0.5000 dollars
      When the month is reported
      Then no Instant Eval meter event is sent and the checkpoint stays at 1.5000
      And spend past 1.5000 since the upgrade is reported as a positive delta

    @unit
    Scenario: A subscription replaced mid-month keeps the month's window
      Given an organization whose subscription was replaced by a new one on the 15th after the month was already reported
      When the month is reported
      Then the spend is read from the replaced subscription's start
      And spend since the last report is sent as a positive delta
      # The window only ever starts earlier within a month, so the floor never swallows new spend.

    @integration
    Scenario: The billing lookup reads every growth-seat period a month can overlap, newest first
      Given an organization with a live subscription, an ended one with both dates, a cancelled one with no start and a pending one with no end
      When its billing lookup is read from Postgres
      Then the periods are the live one and the ended one, newest start first
      And a live subscription with no recorded start comes before every dated one

    @unit
    Scenario: A subscription that cannot be read holds the Instant Eval usage and retries
      Given an organization whose subscription cannot be read from Stripe
      And Instant Eval spend this month
      When the month is reported
      Then no Instant Eval meter event is sent and its checkpoint is not advanced
      And the failed read is counted on the meter's checkpoint
      And another report is scheduled

    @unit
    Scenario: A price read that keeps failing stops at the circuit breaker
      Given an organization whose subscription read fails every time
      When the month is reported again and again
      Then the read is tried five times, each counted on the meter's checkpoint
      And then an alarm is logged and no further report is scheduled

    @unit
    Scenario: A price read that works again clears the failed reads
      Given an organization whose subscription read failed four times
      When the next read works and there is nothing to send, held or priced
      Then the meter's checkpoint counts no failures
      And a later failed read starts the count from one

    @unit
    Scenario: A pending total is replayed even while the price is missing
      Given a meter event whose send was cut off before it was confirmed
      And a subscription that no longer carries the Instant Evals price
      When the month is reported
      Then the pending total is sent again under its own identifier
      # Stripe forgets an identifier after a day; waiting for the price could count it twice.

    @unit
    Scenario: A re-priced Instant Evals line is still recognised
      Given a subscription whose Instant Evals line is on a newer price
      And that price carries the lookup key or the langwatch_key metadata GROWTH_INSTANT_EVAL_USD
      When the month is reported
      Then the usage is reported
      And a price named like it only in its nickname is not taken for it

    @integration
    Scenario: Only a subscription with the Instant Evals price reaches the Stripe simulator
      Given three usage-billed organizations with Instant Eval spend this month
      And one has a Growth subscription in dollars with no Instant Evals price
      And one has a Growth subscription in euros
      And one has a Growth subscription in dollars with the Instant Evals price
      When the month is reported against the payment simulator
      Then the simulator holds no Instant Eval usage for the first two
      And the third's Instant Eval usage equals the month's price in dollars

    @unit
    Scenario: A month with no Instant Eval spend reports nothing on that meter
      Given an organization whose Instant Eval spend this month is zero
      When the month is reported
      Then no Instant Eval meter event is sent

    @unit
    Scenario: Instant Eval spend confirmed after the month's last trace is reported
      Given an organization whose last trace this month was already reported
      And a judged run whose spend gateway confirms after it, with no later trace
      When billing receives the confirmed spend
      Then the month's report runs and the Instant Eval meter receives the month's total
      # ADR-174 decision 20: one billing subscriber on gateway's confirmed spend covers runs,
      # judged queries, the routed judge and hosted Connect spend.

    @unit
    Scenario: Instant Evals no longer nudges the billing report itself
      Given a hosted Connect call whose spend is recorded
      Then Instant Evals dispatches nothing to billing
      # Billing reports the month from gateway's confirmed spend instead.

  Rule: A free organization may spend one dollar in total

    @unit
    Scenario: Under the budget a run is accepted
      Given an organization with no paid plan that has spent 0.99 dollars on Instant Evals
      When a run is requested
      Then it is accepted

    @unit
    Scenario: At the budget a run is refused
      Given an organization with no paid plan that has spent 1.00 dollars on Instant Evals
      When a run is requested
      Then it is refused with instant_eval_free_budget_exhausted
      And the refusal names what was spent and the budget

    @unit
    Scenario: At the budget a synchronous judged query is refused
      Given an organization with no paid plan that has spent the budget
      When a statement calling an eval function is submitted
      Then it is refused with instant_eval_free_budget_exhausted before anything is judged

    # A run records its spend once, when it finishes, so the ledger knows
    # nothing about a run already under way. The page check counts what the run
    # has judged so far, which is what stops one accepted run from judging its
    # whole selection past the budget.
    @unit
    Scenario: A run under way stops when its own judging crosses the budget
      Given a free organization whose ledger spend is under the budget
      And a run whose judged rows have already taken it past the budget
      When the next page is asked for
      Then it is refused with instant_eval_free_budget_exhausted
      And the refusal counts the run's own spend alongside the ledger's

    @unit
    Scenario: A paid organization has no budget
      Given an organization on a paid plan that has spent ten dollars on Instant Evals
      When a run is requested
      Then it is accepted

    # The ledger learns about a run when the run finishes, so an admission
    # check that read the ledger alone would admit any number of runs while
    # none had landed a row. A hold is the run's expected price, kept from
    # acceptance until its spend lands, and every check counts the holds.
    @unit
    Scenario: A run holds its estimated price when it is accepted
      Given a free organization under its budget
      When a run is requested
      Then its estimated price is held under the run's id before the run is queued

    @unit
    Scenario: Runs accepted together share the budget
      Given a free organization with sixty cents of budget left
      When two runs estimated at forty cents each are requested at once
      Then the first is accepted and the second is refused with instant_eval_free_budget_exhausted

    @unit
    Scenario: A run under way counts the runs accepted beside it
      Given a free organization with a run under way and another run's hold
      When the run under way asks for its next page
      Then the check counts the other run's hold and this run's own judging, not its own hold

    @unit
    Scenario: A hold is released when the run's spend lands
      Given a run whose spend was just recorded
      When it finishes, on any outcome
      Then its hold is released after the record and the next check reads the ledger again

    @unit
    Scenario: A hold the worker released does not admit the api's next run against a stale spend
      Given a free organization whose budget covers one run, and the api read its spend a moment ago
      When that run is accepted, finishes on the worker, records its spend and releases its hold
      Then the next two runs the api is asked to start are refused with instant_eval_free_budget_exhausted

    @unit
    Scenario: A run that could not be queued holds nothing
      Given a free organization whose run was accepted but never queued
      When the queue refuses it
      Then the hold taken for it is released

    # Synchronous judging is restored (Alex, 2026-10-06, "Inline eval" and "Judge cycle").
    @unit
    Scenario: A judged query holds its ceiling while it judges
      Given a free organization under its budget
      When a statement calling an eval function is run
      Then the price of the whole query token budget is held before anything is judged
      And the hold is released once the query's spend is recorded

    @integration
    Scenario: Holds are shared across processes
      Given two processes accepting runs for one organization
      When each holds an amount against the same budget
      Then the second sees the first's hold, and a released hold no longer counts

    @unit
    Scenario: The spend is read across every project of the organization
      Given an organization with two projects that spent 0.60 and 0.50 dollars
      When the budget is checked for either project
      Then the spend is 1.10 dollars and the run is refused

    @unit
    Scenario: The spend is cached per organization for one minute
      Given an organization whose spend was read a moment ago
      When the budget is checked again
      Then the ledger is not read a second time

    @unit
    Scenario: The estimate tells a free organization what is left
      Given an organization with no paid plan that has spent 0.40 dollars
      When a run is estimated
      Then the estimate carries the price and sixty cents of free budget remaining

    @unit
    Scenario: The estimate tells a paid organization nothing about a free budget
      Given an organization on a paid plan
      When a run is estimated
      Then the estimate carries the price and no free budget figure

    @integration
    Scenario: The refusal reaches a REST caller as a 402 with its meta
      Given a free organization past the budget
      When a run is requested over REST
      Then the answer is 402 with code instant_eval_free_budget_exhausted
      And meta carries spentUsd and budgetUsd

  Rule: The price on the docs page is the price in the code

    @unit
    Scenario: The pricing page states the shipped rate
      Given the classifier's published rate and markup
      When the pricing page is read
      Then it states the customer price per million input tokens those two produce
