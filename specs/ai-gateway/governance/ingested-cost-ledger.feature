@governance @ingestion
Feature: A push source's cost reaches the budget ledger, never lost and never twice
  A push ingestion source (an OpenTelemetry exporter posting logs) reports a cost
  per request. Governance records that cost as a fact when the batch arrives, and
  the gateway's budget ledger debits the fact in the worker, so a slow or overloaded
  ledger delays a debit but never drops it. The request never writes a ledger row.
  Governance records, gateway debits: no gateway row or Api edge in governance
  (Q208C, the same split as pulled usage).

  Background:
    Given a push ingestion source with cost extraction rules
    And the source belongs to an organization with a budget

  @unit
  Scenario: A pushed cost event is recorded as a fact, not written in the request
    Given a log batch whose records carry a request id and a cost
    When the batch arrives at the source's logs endpoint
    Then governance records one ingested-cost fact per cost, keyed by source and request id
    And the fact names the member the cost's email resolves to, never the email itself
    And the batch is acknowledged

  @unit
  Scenario: A cost that cannot be recorded is answered as retryable
    Given recording the batch's costs fails
    When the batch arrives at the source's logs endpoint
    Then the endpoint answers 503 so the exporter resends the batch
    And no source event is recorded for the refused batch

  @unit
  Scenario: A log batch the pipeline cannot take is answered as retryable
    Given the log pipeline reports itself unavailable
    When the batch arrives at the source's logs endpoint
    Then the endpoint answers 503 so the exporter resends the batch
    And no cost is recorded for the refused batch

  @unit
  Scenario: The gateway budget ledger debits a recorded push cost
    Given governance recorded an ingested-cost fact for an organization budget
    When the gateway's budget ledger receives the fact
    Then the ledger holds one row per applicable budget, under the governance tenant
    And the change feed tells the data plane to re-read the budget

  @unit
  Scenario: A ledger write that fails is retried, never dropped
    Given the budget ledger refuses the write for the moment
    When the gateway's budget ledger receives the fact
    Then the debit fails so the fact is delivered again
    And no crossing or change is announced for the unwritten debit

  @unit
  Scenario: A pushed cost that crosses a budget threshold raises the crossing
    Given governance recorded an ingested-cost fact for an organization budget
    When the gateway's budget ledger debits it
    Then the budget's crossings are checked against the new spend
