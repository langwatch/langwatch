Feature: Instant Evals are metered on the gateway spend spine, reported to Stripe, and free up to a budget

  As the platform
  I want every judged query and run recorded as one spend record, billed monthly, and free until a budget is spent
  So that the customer pays for what was judged, a project budget caps it, and a free organization can try it first

  Issue: Instant Evals, PR 5. ADR-137 §8.

  The shape:
  - One spend record per query or run on the same ledger the AI Gateway writes, `gateway_spend`,
    so the spend page, the budget debits and the billing meter read it with no new table.
  - The record is one confirmed outcome with no admission: the spine already accepts an outcome
    that states its own attribution, and a judgement has no in-flight phase to admit.
  - The customer price rides the record as its cost. Our own cost and the request count ride the
    metadata beside it, so the margin is recoverable without recomputing a rate that will change.
  - A Stripe meter, `langwatch_instant_eval_usd`, receives the month's price per organization.
  - An organization with no paid plan may spend one dollar on Instant Evals in total.

  Rule: A judged query or run is one spend record

    @unit
    Scenario: A finished run is one confirmed spend record addressed by the run
      Given a run that judged two thousand input tokens over forty rows
      When its spend is recorded
      Then one confirmed outcome is dispatched on the gateway spend pipeline
      And its request id is the run's own id under the instant eval prefix
      And its request type is instant_eval, its model is the classifier's and it names no virtual key
      And its input tokens are the run's and its cost is the customer price in nano dollars
      And its metadata carries our own cost and the request count

    @unit
    Scenario: A synchronous query is one confirmed spend record with a fresh id
      Given a query that judged five hundred input tokens
      When its spend is recorded
      Then one confirmed outcome is dispatched with a fresh instant eval query id
      And its metadata names no run

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
      Given a spend pipeline that refuses the outcome
      When a run's spend is recorded
      Then the failure is raised so the finish is delivered again

  Rule: The spend page names the judged rows

    @unit
    Scenario: A spend row with no virtual key and the instant eval request type reads as Instant Evals
      Given a spend row of request type instant_eval
      When the spend page names its key
      Then it says Instant Evals rather than nothing

  Rule: Instant Eval spend debits gateway budgets like any other spend

    @unit
    Scenario: A project budget sees an Instant Eval outcome
      Given an outcome with no virtual key and no provider
      When the debits process handles it
      Then it debits the organization, team and project budgets that apply
      # The debits process already takes an outcome that carries its own
      # attribution; the empty key and provider only narrow which budgets match.

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

    @unit
    Scenario: A month with no Instant Eval spend reports nothing on that meter
      Given an organization whose Instant Eval spend this month is zero
      When the month is reported
      Then no Instant Eval meter event is sent

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
    Scenario: A run that could not be queued holds nothing
      Given a free organization whose run was accepted but never queued
      When the queue refuses it
      Then the hold taken for it is released

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
