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
    Scenario: A batch given no record key is keyed by its own text
      Given a strict batch whose caller names no record
      When the model answers it
      Then its request id is derived from the project and the texts sent

    @unit
    Scenario: The request id cannot be recomputed from a guessed text
      Given a strict batch whose text is short, such as a phone number
      When its request id is derived
      Then it is an HMAC under a key derived from the deployment's key pepper, never a plain hash
      And the same project and texts under another deployment's key give another id

    @unit
    Scenario: A deployment that calls the model and has no key pepper refuses to boot
      Given the PII redaction model endpoint is configured
      And none of API_KEY_PEPPER, CREDENTIALS_SECRET or NEXTAUTH_SECRET is set
      When the data privacy module starts
      Then it refuses to boot, rather than derive request ids anyone can recompute

    @unit
    Scenario: A log record's or metric point's key reaches the model call
      Given a strict log record, or metric point, redacted with a record key
      When the model is asked to clear it
      Then the model call carries that record key, which the request id is derived from

    @unit
    Scenario: A log record is keyed by the time it is stored under
      Given a strict log record
      When it is redacted
      Then its record key is its event time, else its observed time, else the time it was accepted
      And a retried export of the same record carries the same key
      And two identical log lines with different times carry different keys, so each call is charged

    @unit
    Scenario: A metric point is keyed by its metric and its times
      Given a strict metric point
      When it is redacted
      Then its record key names the metric, the point's start time and its time
      And a retried export of the same point carries the same key
      And the same attributes exported a minute later carry a different key, so each call is charged

    @unit
    Scenario: A priced fact that cannot be recorded never fails the redaction
      Given the priced fact's command cannot be dispatched
      When the model answers a strict batch
      Then the batch's redacted texts are returned as usual
      And the failure is logged at error with the organization, the project, the request id and the price

  Rule: A self-hosted install is recorded at no charge

    @unit
    Scenario: A self-hosted install's call is recorded at a price of zero without reading the free list
      Given a self-hosted deployment, where the install runs the model itself
      When the model answers a strict batch of 1,000 characters
      Then one priced fact is recorded with a price of zero
      And neither the free list nor an acceptance of the price is read, so no flag has to be set for it

  Rule: An organization on the free list is recorded at no charge

    The free list is read when a batch is routed, not when its call is priced: the call is priced
    as it was routed, so a free-list change during a call of up to 50 seconds never prices it.

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

    @unit
    Scenario: A batch whose free list cannot be read goes to Presidio and is priced for nobody
      Given an organization whose free-list entry cannot be read
      When a strict batch of 1,000 characters is routed
      Then Presidio answers it, the model is not called and no priced fact is recorded
      And the batch is counted with the reason routing_error

    @unit
    Scenario: The spend recorder prices a call as it was routed and reads no flag
      Given a call the model answered, routed as priced or as free
      When its priced fact is recorded
      Then a priced call is recorded at the published rate and a free one at zero
      And the recorder reads neither the free list nor any other flag

  Rule: Only an organization whose admin accepted the price is billed

    ADR-201 decision 15. Spend recorded before an organization admin accepted the price (by a
    release that routed Strict organizations to the model without asking) is never billed: the
    monthly report counts only spend at or after the acceptance, and nothing without one.

    @unit
    Scenario: An organization that accepted the price is billed only from the moment it accepted
      Given an organization whose admin accepted the PII redaction model's price on the 10th of the month
      And PII redaction spend recorded before and after that moment
      When the month is reported
      Then the meter's total counts only the spend from the moment of acceptance on

    @unit
    Scenario: An organization that never accepted the price reports no PII redaction spend
      Given an organization with PII redaction spend this month and no acceptance of the price
      When the month is reported
      Then the meter's total is zero and the spend ledger is not read

    @unit
    Scenario: A month that ended before the organization accepted reports no PII redaction spend
      Given an organization whose admin accepted the price after a month ended
      And PII redaction spend recorded in that month
      When that month is reported
      Then the meter's total is zero and the spend ledger is not read

    @unit
    Scenario: The acceptance is the organization's own record, kept once
      Given an organization admin accepts the PII redaction model's price
      And another admin accepts it later
      Then the organization keeps the first moment and the first admin
      And an unknown organization reads as not accepted

  Rule: The Cloud price holds for each kind of customer

    Decided 2026-11-23: 0.50 dollars per 1M characters, no free monthly amount, no minimum per
    call, and the free list stays with no end date. Each case is an organization with the PII
    redaction model flag on; the price is fixed in data-privacy, so every case asserts exact amounts.

    @unit
    Scenario: A paying organization's long and simple spans are each priced by their characters
      Given an organization not on the free list, whose admin accepted the price, with a Strict project
      When the model answers a long span of 7,900 characters and a simple span of 50 characters
      Then the long span is one priced fact of 3,950,000 nano dollars
      And the simple span is one priced fact of 25,000 nano dollars, raised to no minimum
      And both carry the rate version pii_redaction@500nano_per_char and a request id of their own

    @unit
    Scenario: The characters priced are the ones sent to the model, after standard detection
      Given an organization not on the free list, whose admin accepted the price, with a Strict project
      When it sends a span whose text holds a phone number
      Then standard detection masks the phone number in-process before the model is called
      And the priced fact counts the characters of the masked text the model was sent

    @unit
    Scenario: A free organization's long spans are recorded at zero with our cost kept
      Given an organization on the release_pii_redaction_model_free list, with a Strict project
      When the model answers a long span of 7,900 characters
      Then one priced fact is recorded with its 7,900 characters, a price of zero and our cost above zero

    @unit
    Scenario: A span over the model's length cap is redacted by Presidio and priced for nobody
      Given an organization with a Strict project, on the free list or not, and splitting off
      When it sends a span of 12,000 characters
      Then Presidio redacts the span and the model is not called
      And no priced fact is recorded

    @unit
    Scenario: A split span is priced once on its characters, never on its overlap
      Given a paying Cloud organization with a Strict project and splitting on (ADR-207)
      When the model answers a span of 20,000 characters in several split calls
      Then one priced fact is recorded with 20,000 characters and the price of 20,000 characters
      And our cost on it is the duration charge of every call plus one request fee per call

    @unit
    Scenario: The same split span redacted twice is one request
      Given a split span whose redaction runs twice because its ingestion was retried
      When the model answers both times
      Then both priced facts carry the same request id, the one an unsplit call of the same texts would carry

    @unit
    Scenario: A split span with a failed call is priced for nobody
      Given a split span one of whose calls fails
      When Presidio redacts it instead
      Then no priced fact is recorded

    @unit
    Scenario: A span over 32,000 characters is redacted by Presidio and priced for nobody
      Given an organization with a Strict project and splitting on
      When it sends a span of 40,000 characters
      Then Presidio redacts the span and no model is called
      And no priced fact is recorded

    @unit
    Scenario: An organization that declined Strict at a price stays on Essential and is never priced
      Given an organization with the flag whose level stayed Essential, because it cancelled Strict's price
      When it sends a long span and a simple span
      Then neither the model nor Presidio is called and no priced fact is recorded

    @integration
    Scenario: A paying organization's month reaches Stripe at 0.50 dollars per million characters
      Given a usage-billed organization whose Growth subscription in dollars carries the PII redaction price
      And a month of 2,095,000 characters answered by the model, with no free amount taken off
      When the month is reported against the payment simulator
      Then the simulator's usage for langwatch_pii_redaction_usd is 1.0475

    @integration
    Scenario: A free organization's month sends nothing to Stripe
      Given a usage-billed organization whose Growth subscription in dollars carries the PII redaction price
      And a month of model calls all recorded at a price of zero
      When the month is reported against the payment simulator
      Then the simulator holds no usage for langwatch_pii_redaction_usd

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

  Rule: The spend page names a PII redaction row by what it is

    @unit @integration
    Scenario: A spend row with no virtual key and the pii redaction request type reads as PII redaction
      Given a spend row of request type pii_redaction
      When the spend page names its key
      Then it says PII redaction rather than nothing

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
    Scenario: Usage is held while the subscription carries no PII redaction price
      Given a Stripe mode whose catalog maps the PII redaction meter
      And an organization whose active subscription has no PII redaction price
      And PII redaction spend this month
      When the month is reported
      Then no PII redaction meter event is sent and its checkpoint is not advanced
      And the first report after the price is added reads the spend from the moment the line was added
      And a warning names the organization, the meter and the amount held
      # Stripe drops a meter event no subscription item prices, so sending it would lose the charge.

    @unit
    Scenario: A pending PII redaction total is replayed even while the price is missing
      Given a PII redaction meter event whose send was cut off before it was confirmed
      And the spend from the organization's acceptance on still covers its total
      And a subscription that no longer carries the PII redaction price
      When the month is reported
      Then the pending total is sent again under its own identifier
      # Stripe forgets an identifier after a day; waiting for the price could count it twice.

    @unit
    Scenario: A pending PII redaction total above the spend the acceptance covers is replayed, then corrected down
      Given a PII redaction meter event whose send was cut off before it was confirmed
      And its total is above the spend recorded from the organization's acceptance on
      When the month is reported twice
      Then the pending total is sent again under its own identifier and kept as reported
      And the next report sends the negative difference down to the spend from the acceptance on
      And an organization that never accepted ends the month at zero
      # Stripe may already hold the cut-off send; only its own identifier tells Stripe not to count it twice.

    @unit
    Scenario: A pending PII redaction total is replayed without waiting for the spend to be read
      Given a PII redaction meter event whose send was cut off before it was confirmed
      And the spend from the organization's acceptance on cannot be read, or its read fails
      When the month is reported
      Then the pending total is sent again under its own identifier at once
      # Waiting for the read could outlast the day Stripe keeps an identifier, and count it twice.

    @unit
    Scenario: Usage is reported once the subscription carries the PII redaction price
      Given an organization whose active subscription has the PII redaction price
      And PII redaction spend this month
      When the month is reported
      Then the PII redaction meter event is sent

    @unit
    Scenario: A subscription that cannot be read holds the usage and retries
      Given an organization whose subscription cannot be read from Stripe
      And PII redaction spend this month
      When the month is reported
      Then no PII redaction meter event is sent and its checkpoint is not advanced
      And the failed read is counted on the meter's checkpoint
      And another report is scheduled

    @unit
    Scenario: A PII redaction price read that keeps failing stops at the circuit breaker
      Given an organization whose subscription read fails every time
      And PII redaction spend this month
      When the month is reported again and again
      Then the read is tried five times, each counted on the PII redaction meter's checkpoint
      And then an alarm is logged and no further report is scheduled

    @unit
    Scenario: The other meters do not wait on the PII redaction price
      Given an organization whose active subscription has no PII redaction price
      And billable events and Instant Eval spend this month
      When the month is reported
      Then the billable events and Instant Evals meter events are sent

    @unit
    Scenario: A Growth checkout in dollars carries the PII redaction price
      Given a Stripe mode where the PII redaction price is provisioned
      When a Growth checkout in dollars is built
      Then it carries the metered PII redaction item with no quantity

    @unit
    Scenario: A Growth checkout in euros carries no PII redaction price
      Given a Stripe mode where the PII redaction price is provisioned
      When a Growth checkout in euros is built
      Then it carries no PII redaction item
      # The meter counts dollars; a euro subscription cannot hold a dollar price.

    @unit
    Scenario: A Growth checkout works where the PII redaction price is not provisioned
      Given a Stripe mode whose catalog maps no PII redaction price
      When a Growth checkout in dollars is built
      Then it carries the seat and events items only

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

    @unit
    Scenario: PII redaction spend confirmed after the month's last trace is reported
      Given an organization whose last trace this month was already reported
      And a redaction whose spend gateway confirms after it, with no later trace
      When billing receives the confirmed spend
      Then the month's report runs and the PII redaction meter receives the month's total

    @integration
    Scenario: PII redaction spend after the month's last trace reaches the Stripe simulator
      Given a usage-billed organization whose last trace this month was already reported
      And gateway confirms a pii_redaction spend whose row lands after the first report ran
      When the follow-up report runs, with no later trace
      Then the simulator's usage for langwatch_pii_redaction_usd equals the month's price in dollars

    @integration
    Scenario: The month's PII redaction total reaches the Stripe simulator
      Given a usage-billed organization whose Stripe catalog maps the PII redaction meter
      And PII redaction rows on its spend ledger this month
      When the month is reported against the payment simulator
      Then the simulator's usage for langwatch_pii_redaction_usd equals the month's price in dollars
