Feature: A PII redaction model call is priced per character, written to the spend ledger and reported to Stripe

  As the platform
  I want every batch the PII redaction model answers recorded once, at a published price per character
  So that the customer pays for what the model redacted, and charging starts only when Stripe holds the meter

  ADR-201. The pattern is the Instant Evals judge's (ADR-174 decision 13): the owning module
  prices the call and records a priced fact; gateway writes the ledger row; billing reports the
  month's dollars on a meter of its own.

  The interactions, in order:
  - data-privacy: a strict batch the model answers is priced and recorded as one priced fact
    on the organization's aggregate, keyed by a request id derived from the batch.
  - gateway: a peer subscriber on that fact writes one confirmed row on `gateway_spend`, request
    type `pii_redaction`, and looks up the project's team itself.
  - billing: the monthly report sums the `pii_redaction` rows across the organization's projects
    and sends the delta to the `langwatch_pii_redaction_usd` meter, once Stripe holds it.

  Rule: A batch the model answers is one priced fact

    @unit
    Scenario: An answered batch is priced at the published rate per character
      Given an organization allowlisted for the PII redaction model
      When the model answers a strict batch of 1,000 characters
      Then one priced fact is recorded for the organization and the project
      And its price is 500,000 nano dollars, which is 0.00005 dollars per 100 characters
      And it carries the characters, the number of texts and the rate version
      And it carries our own estimated cost of the call beside the price

    @unit
    Scenario Outline: A batch the model did not answer is not priced
      Given an organization allowlisted for the PII redaction model
      When a strict batch falls back to Presidio because of <reason>
      Then no priced fact is recorded

      Examples:
        | reason       |
        | too_long     |
        | breaker_open |
        | timeout      |
        | throttled    |
        | error        |

    @unit
    Scenario: An organization that is not allowlisted is never priced
      Given an organization not allowlisted for the PII redaction model
      When a strict batch is analysed
      Then no priced fact is recorded

    @unit
    Scenario: The same span redacted twice is one request
      Given a span whose redaction runs twice because its ingestion was retried
      When the model answers both times
      Then both priced facts carry the same request id
      And the spend ledger, keyed by project and request id, keeps one row, so the customer is charged once

    @unit
    Scenario: Two spans with the same text are two requests
      Given two spans of one trace whose texts are identical
      When the model answers both
      Then their priced facts carry different request ids

    @unit
    Scenario: A log record or metric point with no span is keyed by its own text
      Given a strict log record that names no trace or span
      When the model answers it
      Then its request id is derived from the project and the texts sent

    @unit
    Scenario: A priced fact that cannot be recorded never fails the redaction
      Given the priced fact's command cannot be dispatched
      When the model answers a strict batch
      Then the batch's redacted texts are returned as usual
      And the failure is logged at error with the organization, the project, the request id and the price

  Rule: An organization on the free list is recorded at no charge

    @unit
    Scenario: A free organization's call is recorded at a price of zero
      Given an organization on the release_pii_redaction_model_free list
      When the model answers a strict batch of 1,000 characters
      Then one priced fact is recorded with a price of zero
      And our own estimated cost is still recorded beside it

    @unit
    Scenario: The free list is read once per minute per organization
      Given an organization whose free-list entry was read a moment ago
      When the model answers another of its batches
      Then the free list is not read again

  Rule: Gateway writes one ledger row per priced fact

    @unit
    Scenario: The ledger row carries the price as its cost and names the PII redaction model
      Given a priced fact for a project of a team
      When gateway handles it
      Then it writes one confirmed row of request type pii_redaction, model pii-redaction-model and no virtual key
      And its cost is the customer price in nano dollars and its input tokens are zero
      And its metadata carries the characters, the number of texts and our own cost in dollars

    @unit
    Scenario: A fact for a project with no team is logged, not written
      Given a priced fact whose project no longer exists
      When gateway handles it
      Then no row is written
      And the fact is logged at error with the organization, the project, the request id and the price

    @unit
    Scenario: A spend pipeline that is not registered makes the fact be delivered again
      Given a gateway whose spend pipeline is not registered
      When gateway handles a priced fact
      Then the handler throws so the fact is delivered again

  Rule: PII redaction spend is outside gateway budgets

    @unit
    Scenario: A pii_redaction outcome debits no budget
      Given a confirmed outcome of request type pii_redaction
      When the debits process handles it
      Then no organization, team or project budget is debited
      # A full AI budget must never turn redaction off; the invoice is the only cap.

  Rule: The month's PII redaction price is one Stripe meter per organization

    @unit
    Scenario: The meter is named langwatch_pii_redaction_usd
      When the month's PII redaction spend is reported
      Then the meter event is named langwatch_pii_redaction_usd

    @unit
    Scenario: The value is the month's price in dollars to four places
      Given an organization whose PII redaction spend this month is 12345678900 nano dollars
      And nothing reported yet
      When the month is reported
      Then the meter event's value is 12.3456

    @unit
    Scenario: A second report sends only the delta since the checkpoint
      Given a PII redaction checkpoint that reported 1.0000 dollars
      And the month's PII redaction spend is now 1.5000 dollars
      When the month is reported
      Then the meter event's value is 0.5000
      And its identifier names the meter, the month and both totals

    @unit
    Scenario: The PII redaction meter keeps its own checkpoint
      Given an organization with billable events, Instant Eval spend and PII redaction spend in one month
      When the month is reported
      Then each meter's checkpoint is written under its own name
      And the billable events and Instant Evals identifiers are unchanged

    @unit
    Scenario: The PII redaction meter is reported only once Stripe holds it
      Given a Stripe mode whose catalog maps no PII redaction meter
      And an organization with PII redaction spend this month
      When the month is reported
      Then no PII redaction meter event is sent and its checkpoint is not advanced
      And the first report after the meter is mapped carries the month from zero

    @unit
    Scenario: The spend is read across every project of the organization
      Given an organization with two projects whose PII redaction spend is 0.60 and 0.50 dollars
      When the month is reported
      Then the meter's total is 1.1000 dollars

    @unit
    Scenario: An organization that is not usage billed reports nothing
      Given an organization with no active subscription and PII redaction spend this month
      When the month is reported
      Then no meter event is sent

    @integration
    Scenario: The month's PII redaction total reaches the Stripe simulator
      Given a usage-billed organization whose Stripe catalog maps the PII redaction meter
      And PII redaction rows on its spend ledger this month
      When the month is reported against the payment simulator
      Then the simulator's usage for langwatch_pii_redaction_usd equals the month's price in dollars
