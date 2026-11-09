Feature: Billing storage kept past the 90 days Growth includes

  Growth includes 90 days of retention (kept as 91 days). An organization that
  keeps data longer pays for the storage of rows older than 91 days, at EUR 3
  or USD 4 per GB a month. The subscription carries a metered storage line
  while the longest retention rule is above 91 days or keeps data forever.
  Every day the worker measures the bytes each organization keeps in rows
  older than 91 days and reports that day's share of a GB-month, the GB
  divided by the days in the UTC month. The meter sums, so a month reported
  every day bills the average GB kept that month, and a day that was missed
  bills nothing rather than a guess.

  The report is event-sourced. Once a day the worker sends one measure
  command per organization. The command records one measurement event for
  that organization and day, keyed by the meter identifier
  retention-storage:<organization>:<day>. A billing process reads each
  measurement and sends it to the meter through its own outbox, so a failed
  send is retried without measuring again. The hand-run task sends the same
  command.

  @unit
  Scenario: A checkout with a retention above 90 days adds the storage line
    When a Growth seat checkout is opened with a retention of 182 days
    Then the checkout line items include the storage price for its currency and interval

  @unit
  Scenario: A checkout at 90 days or less has no storage line
    When a Growth seat checkout is opened with a retention of 91 days
    Then the checkout line items hold only the seat line

  @unit
  Scenario: A day's measurement is reported as its share of a GB-month
    Given a Growth subscription with the storage line
    When 30 GB past 91 days is reported on a day in a 30 day month
    Then the meter receives 1 GB-month for that organization and day

  @unit
  Scenario: The same day is reported only once
    Given the storage of an organization was reported today
    When the report runs again the same day
    Then the meter refuses the duplicate and the report counts it as done

  @unit
  Scenario: A longer retention adds the storage line to a running subscription
    Given a Growth subscription without the storage line
    When the organization keeps traces for 182 days
    Then the storage line is added in the subscription's currency and interval

  @unit
  Scenario: Going back to 90 days removes the storage line
    Given a Growth subscription with the storage line
    When the organization's longest retention becomes 91 days
    Then the storage line is removed without proration

  @unit
  Scenario: A missing storage price leaves the subscription alone
    Given the storage prices are not provisioned in this Stripe mode
    When the organization keeps traces for 182 days
    Then the subscription is not changed and nothing is reported

  @unit
  Scenario: An organization without a live Growth seat subscription is not billed
    Given an organization on the Free plan with a retention of 182 days
    When the daily report runs
    Then nothing is measured or reported for it

  @unit
  Scenario: The report measures only rows older than 91 days, across every project
    Given an organization with two projects keeping 182 days of traces
    And each project wrote rows both before and after 91 days ago
    When the daily report runs
    Then billing is told the bytes of the older rows of both projects

  @unit
  Scenario: A retention rule change aligns the storage line
    Given a Growth organization that keeps 91 days
    When an administrator changes its traces retention to 182 days
    Then billing is asked to align the storage line for that organization

  @unit
  Scenario: A billing failure does not undo a retention change
    Given billing cannot be reached
    When an administrator changes its traces retention to 182 days
    Then the retention rule is saved

  @unit
  Scenario: One organization failing does not stop the daily report
    Given two organizations with long retention, one whose measurement fails
    When the daily report runs
    Then the other organization is still reported and one failure is counted

  @unit
  Scenario: The daily wake asks for one measurement per organization
    Given two organizations with long retention
    When the daily report wakes
    Then one measure command is sent for each organization, for that UTC day

  @integration
  Scenario: Each organization is measured once a day as one event
    Given an organization with a Growth subscription and the storage line
    And it keeps rows older than 91 days
    When the measure command runs for that day
    Then one measurement event is recorded for that organization and day
    And it carries the GB past 91 days, the day's share and the meter identifier
    And the meter receives that day's share once

  @integration
  Scenario: A rerun on the same day bills nothing twice
    Given the storage of an organization was measured and billed today
    When the measure command runs again the same day
    Then the meter is not sent a second share for that day

  @integration
  Scenario: A failed meter send retries without a second measurement
    Given billing fails the first time a day's measurement is sent
    When the measure command runs for that day
    Then the storage is measured once
    And the send is retried until the meter receives the day's share

  @unit
  Scenario: The hand-run report sends the same measure command
    When an operator runs the retention storage report for one organization
    Then one measure command is sent for that organization, for today

  @integration
  Scenario: The storage read filters every metered table on its partition column
    Given the ClickHouse tables the storage meter reads
    Then each table's row time column is the column its partition key is built from

  @integration
  Scenario: The storage read counts only rows written before the cutoff
    Given a project with spans written 120 days ago and today
    When the bytes before 91 days ago are read
    Then only the older spans are counted
