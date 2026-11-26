Feature: Instant Evals and PII redaction usage is billed only from the moment its price line was added

  All charges start from the day the usage price line is added to the Stripe subscription
  (Sergio, 2026-11-26). Before, the first report after a line was added carried the whole
  month from its first day, so usage from before the line reached the invoice.

  The report already reads the customer's subscriptions to check the line (ADR-174 decision
  18, ADR-201 decision 10). It now also reads when that line was created, and each usage
  meter's month starts at the latest of the month's start, the growth-seat subscription's
  start (ADR-174 decision 23) and the line's creation. ADR-174 decision 26.

  Rule: A usage meter's month starts no earlier than its price line

    @unit
    Scenario: Usage before the price line was added is never billed
      Given an organization whose usage was held for want of the Instant Evals price
      When the line is added on the 12th of the month and the month is reported
      Then the spend is read from the moment the line was added
      And the meter event carries only the spend since then

    @unit
    Scenario: Usage after the price line was added is billed
      Given an organization whose subscription has carried the Instant Evals line since before the month
      When the month is reported
      Then the spend is read from the month's start
      And the meter event carries the month's spend

    @unit
    Scenario: A PII redaction line added mid-month bills only from that moment
      Given an organization whose subscription gained the PII redaction line on the 10th
      And PII redaction spend both before and after the 10th
      When the month is reported
      Then the PII redaction spend is read from the moment the line was added
      And the meter event carries only the spend since then

    @unit
    Scenario: The month starts at the later of the subscription's start and the line's
      Given a growth-seat subscription that started on the 3rd
      And an Instant Evals line added to it on the 10th
      When the month is reported
      Then the spend is read from the 10th

    @unit
    Scenario: A line removed and added again bills from the line now on the subscription
      Given a subscription whose Instant Evals line was removed and a new one added on the 20th
      When the line's start is read
      Then it is the new line's creation on the 20th

    @unit
    Scenario: A subscription replaced mid-month keeps the earlier line's start
      Given a cancelled subscription that carried the line since before the month and ended on the 15th
      And its replacement, which carries the line from the 15th
      When the line's start is read for that month
      Then it is the cancelled subscription's line, so the window never moves later after a report
      # Only a cancellation at or after the new line's creation, within a minute's tolerance, chains.

    @unit
    Scenario: Usage while no line existed anywhere is never billed
      Given a cancelled subscription whose line ended on the 6th
      And a new subscription whose line was added on the 15th
      And spend of 1 dollar on the 3rd, 4 dollars on the 10th and 2 dollars on the 20th
      When the month is reported
      Then the spend is read from the 15th, so the 4 dollars from the gap are never billed

    @unit
    Scenario: A line on a subscription that ended before the month does not set its start
      Given a subscription that carried the line and ended before the month
      And a live one whose line was added on the 10th
      When the line's start is read for that month
      Then it is the live line's creation on the 10th

    @unit
    Scenario: A line with no recorded creation is refused as a failed read
      Given a subscription line with no creation time
      When the month is reported
      Then nothing is sent for that meter and the read counts as a failure toward the breaker
      # Reading the month from its first day instead would bill usage from before the line.

    @unit
    Scenario: Without the line nothing is read as billed
      Given a subscription with no line on the price
      When the line's start is read
      Then the price is not carried

    @unit
    Scenario: A month already reported is not lowered when the line's start narrows it
      Given a PII redaction checkpoint that reported 1.5000 dollars
      And the window from the line's creation now reads 0.5000 dollars
      When the month is reported
      Then no PII redaction meter event is sent and the checkpoint stays at 1.5000
      # A narrowed window only stops what is still to send; it never takes back what was sent.

    @unit
    Scenario: A connected customer's hosted usage keeps the whole month
      Given a connected account, whose hosted usage is not checked for a line
      When the month is reported
      Then the Instant Evals spend is read from the month's start

    @unit
    Scenario: The line's creation and the subscription's end are read off Stripe
      Given Stripe answers a subscription with an item created at a time and an end time
      When billing reads the subscription
      Then the line carries its creation time and the subscription its end time
