Feature: Instant Eval processing interruptions are visible
  As a Trace Explorer user
  I want to know when a processing step was disabled
  So that I do not mistake incomplete reporting for a healthy run

  @unit @regression
  Scenario: A disabled request refuses admission without a run or budget hold
    Given the requestRun kill switch is on for my project
    When I start an Instant Eval
    Then I receive an actionable processing-disabled error
    And no run, budget hold or command is created

  @unit @regression
  Scenario: Every disabled run command records its actual refusal
    Given a command was queued before its switch was turned on
    When any Instant Eval command worker refuses the command
    Then a durable receipt identifies its project, run and processing stage
    And no event is appended

  @unit @regression
  Scenario: A skipped projection records every refused event
    Given the Instant Eval run projection is disabled
    When a batch of events reaches that projection
    Then a durable receipt identifies every refused event and run
    And no counters are applied

  @unit @regression
  Scenario: Receipt write failure retries only the refused job
    Given a processing step is disabled and receipt storage fails
    When the command or projection worker attempts the job
    Then the job is rejected for retry
    And the paid judging intent is not repeated

  @unit @regression
  Scenario: A paid page refusal does not repeat judging
    Given a page was judged and its outcomes were written
    When recording that page is disabled
    Then the run reports an interruption
    And recording retries never judge the page again

  @unit @regression
  Scenario: Interruption evidence survives flag restoration and terminal reporting
    Given a processing refusal has been recorded
    When the flag is restored and a later terminal status is projected
    Then get and list still report the interruption with original lifecycle facts

  @integration @regression
  Scenario: Interruption storage deduplicates receipts and isolates projects
    Given duplicate receipts and runs in two projects
    When interruption evidence is read
    Then each project sees only its deduplicated run stages
    And a later run projection write cannot erase the receipt

  @unit
  Scenario: Enabled processing preserves normal events and counters
    Given all processing switches are off
    When Instant Eval commands and projections run
    Then normal events and counters are unchanged
    And no interruption is reported
