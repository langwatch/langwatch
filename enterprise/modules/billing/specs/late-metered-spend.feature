Feature: Spend confirmed after a month's last trace still reaches Stripe

  The monthly report used to run only on usage's month_counted event, which follows
  traces. Instant Evals and PII redaction spend is written to gateway's spend ledger on
  its own, so spend confirmed after a month's last trace was never reported.

  Billing therefore also listens to gateway's confirmed spend. One subscriber covers runs,
  judged queries, the routed judge, hosted Connect spend and PII redaction, because all of
  them confirm a gateway spend row. ADR-174 decision 20.

  Rule: A confirmed Instant Evals or PII redaction spend dispatches its month's report

    @unit
    Scenario: Billing subscribes to gateway's confirmed spend
      Given the monthly roll-up's eventing declaration
      When its peer subscribers are registered
      Then one of them takes lw.gateway.spend.confirmed

    @unit
    Scenario: A confirmed Instant Evals spend dispatches the report for its organization and month
      Given gateway confirms an instant_eval spend for an organization
      When billing receives it
      Then billing dispatches the report for that organization and month

    @unit
    Scenario: A confirmed PII redaction spend dispatches the report for its organization and month
      Given gateway confirms a pii_redaction spend for an organization
      When billing receives it
      Then billing dispatches the report for that organization and month

    @unit
    Scenario: The month is the UTC month the spend occurred in
      Given a spend confirmed at the last millisecond of October in UTC
      And another confirmed at the first millisecond of November in UTC
      When billing receives both
      Then the first reports October and the second reports November

    @unit
    Scenario: A spend report leaves the events meter on its own cursor
      Given a report dispatched by a confirmed spend
      Then it carries no events total and no counted event id
      And when it runs, the events meter sends nothing and its checkpoint is untouched

    @unit
    Scenario: Spend of any other request type dispatches nothing
      Given gateway confirms a chat completion's spend
      When billing receives it
      Then no report is dispatched

    @unit
    Scenario: A spend naming no organization dispatches nothing
      Given gateway confirms an instant_eval spend with an empty organization
      When billing receives it
      Then no report is dispatched

    @unit
    Scenario: Spend no meter bills is skipped before it is queued
      Given gateway confirms a chat completion's spend, or a spend with an empty organization
      When the spend subscriber decides whether to queue it
      Then it is not queued, while a pii_redaction spend is

    @unit
    Scenario: A burst of spend for one organization and month is one report
      Given gateway confirms several instant_eval spends for one organization in one month
      When billing receives them
      Then every dispatch carries the same dedupe key and the report's usual delay
      And a spend arriving while the report waits joins it without pushing it later

    @unit
    Scenario: A spend report that cannot be dispatched is raised so the event is delivered again
      Given a report queue that refuses the dispatch
      When billing receives a confirmed instant_eval spend
      Then the failure is raised

  Rule: A report dispatched by spend sends exactly one follow-up

    @unit
    Scenario: A spend report dispatches one follow-up for the same organization and month
      Given a report dispatched by a confirmed spend
      When it runs for a usage-billed organization
      Then it dispatches exactly one follow-up report for the same organization and month
      And the follow-up is sent after a longer delay than the report's

    @unit
    Scenario: The follow-up dispatches no further report
      Given a follow-up report whose spend has not changed
      When it runs
      Then no report is dispatched

    @unit
    Scenario: A spend row that lands within the follow-up's delay is still sent
      Given a spend report that ran before gateway wrote the spend row
      And the row is on the ledger when the follow-up runs
      When the follow-up runs
      Then the month's total is sent to Stripe

    @unit
    Scenario: A report dispatched by month_counted dispatches no follow-up
      Given a report that carries no spend marker, as every report before this change
      When it runs and has nothing new to send
      Then no report is dispatched

    @unit
    Scenario: A spend or convergence report never replaces the follow-up, and a later follow-up moves it later
      Given the dedupe keys of a spend report and of its follow-up
      Then they differ, so neither replaces the other in the queue
      And the follow-up's dedupe window covers its delay
      And a later spend report's follow-up shares its key, so the pending one is sent later rather than twice

    @unit
    Scenario: A spend report for an organization that is not usage billed dispatches no follow-up
      Given a report dispatched by a confirmed spend for an organization on a free plan
      When it runs
      Then no report is dispatched

    @unit
    Scenario: A spend report whose organization cannot be read is retried without a follow-up
      Given a report dispatched by a confirmed spend
      And the organization's billing details cannot be read
      When it runs
      Then the failure is raised so the report is retried
      And no follow-up is dispatched

    @integration
    Scenario: Spend confirmed after the month's last trace is invoiced through the Stripe simulator
      Given a usage-billed organization whose last trace this month was already reported
      And gateway confirms a pii_redaction spend whose row is not yet on the ledger
      When the report runs, then the row lands and the follow-up runs, with no later trace
      Then the simulator's usage for langwatch_pii_redaction_usd equals the month's price
