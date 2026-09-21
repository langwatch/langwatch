Feature: The usage report a self-hosted install sends
  Every install reports what it is and what it does, once a day. The fields are
  declared in one dictionary, so the report, the docs page and the screen that
  shows a customer their own payload all come from the same list and cannot
  disagree.

  Every field carries a category. The optional category is switchable as a
  whole, and hostname on its own, because it names the customer's own network.
  Trace content, prompts, dataset contents, evaluation inputs and outputs,
  project names, user names, email addresses, IP addresses and keys are never
  collected, and the docs page says so.

  As a customer running LangWatch on my own infrastructure
  I want to see exactly what my install reports, and switch off the parts I would rather keep
  So that I can answer my own security review without taking anybody's word for it

  Background:
    Given a self-hosted install with usage reporting left on

  # ============================================================================
  # The dictionary is the one list
  # ============================================================================

  @unit
  Scenario: Every field the report carries declares a category and a reason
    When the dictionary is read
    Then each field names one of the four categories
    And each field carries the sentence that explains why it is collected
    And each field names where its value is read from
    And no field is declared twice

  @unit
  Scenario: The receiver names every field the dictionary declares
    When the dictionary is compared with the receiver
    Then every declared field is one the receiver accepts
    And a field the dictionary does not declare never reaches the report

  @unit
  Scenario: The docs page lists every field the dictionary declares
    When the docs page is rendered from the dictionary
    Then every field appears with its window and the reason it is collected
    And the page names the schema version it describes
    And the list of what is never collected is on it

  @unit
  Scenario: The docs page fails the build when it is stale
    Given a field was added to the dictionary and the page was not regenerated
    When the committed page is compared with the dictionary
    Then the build fails and names the command that regenerates the page

  @unit
  Scenario: The docs page states what is never collected
    When the list of what is never collected is read
    Then it names trace content, prompts, dataset contents and evaluation inputs and outputs
    And it names project names, user names, email addresses and IP addresses
    And it names keys of every kind

  # ============================================================================
  # What a customer can switch off
  # ============================================================================

  @unit
  Scenario: Switching the optional category off removes it from the report
    Given a customer who switched the optional category off
    When the report is taken
    Then it still says which release runs and how many projects the install carries
    But it carries no usage counts, no onboarding dates and no email domains

  @unit
  Scenario: Hostname has a switch of its own
    Given a customer who switched hostname off and nothing else
    When the report is taken
    Then the hostname is absent
    And the rest of the optional category is still there

  # ============================================================================
  # Identity
  # ============================================================================

  @unit
  Scenario: Company identity travels as aggregated domains, never an address
    Given two people on acme.test and one on other.test
    When the report is taken
    Then it carries acme.test with a count of two and other.test with a count of one
    And it carries no email address

  @unit
  Scenario: The report names the install and not its organizations
    When the report is taken
    Then it carries the identity minted into this install's own database
    And no organization id appears anywhere in it

  # ============================================================================
  # Windows
  # ============================================================================

  @unit
  Scenario: Counts are reported lifetime and over two windows
    When the report is taken
    Then each windowed figure appears three times: lifetime, over seven days and over twenty-eight days
    And an install that ingested heavily two years ago and nothing since reads differently from one ingesting today

  # ============================================================================
  # What they do, by family
  # ============================================================================

  @integration
  Scenario: Spans are counted from what the install stores, lifetime and over two windows
    Given spans stored three, twenty and forty days ago, and another install's spans
    When spans are counted
    Then the lifetime figure counts every span of this install
    And the seven day figure counts only the span from three days ago
    And the twenty-eight day figure leaves out the span from forty days ago
    And no span of the other install is counted

  @integration
  Scenario: Gateway requests and spend come from the spend ledger
    Given a gateway request admitted at one price and settled at another
    And a request from forty days ago
    When gateway requests and spend are read
    Then the settled request counts once, at its settled cost in USD
    And the lifetime figures cover both requests while the windows cover the recent one
    And the first gateway request is dated from the oldest row

  @integration
  Scenario: Instant Eval runs and judgments are counted
    Given an Instant Eval run three days ago with two judgments, one twenty days ago, and one forty days ago
    When runs and judgments are counted
    Then each is counted lifetime and over both windows
    And the first run is dated from the oldest row

  @integration
  Scenario: Langy turns and the people sending them are counted
    Given one person with a conversation active this week and one long idle
    And another person whose conversation opened twenty days ago
    When the stored counts are taken
    Then turns are counted by the day the fold stamped them
    And people are counted once each, by the last activity of their conversations
    And the first Langy turn is dated from the oldest turn

  @integration
  Scenario: Coding agent sessions are counted once each
    Given a coding agent session folded twice and a session from forty days ago
    When sessions are counted
    Then the re-folded session counts once
    And the windows leave out the old session

  @integration
  Scenario: Pull requests are counted by the day they were opened
    Given pull requests opened three, twenty and forty days ago, all noticed by the install today
    When the stored counts are taken
    Then the windows are cut on the day each pull request was opened
    And another organization's pull requests are not counted

  @integration
  Scenario: The ladder gains the first gateway request, Instant Eval run and coding agent session
    When the ladder is read for an install that reached a rung
    Then the rung carries the day of the oldest row
    And a rung the install never reached is null rather than the start of time

  @unimplemented @unit
  Scenario: The onboarding ladder records the day each rung was first reached
    When the report is taken
    Then each rung carries the day it was first reached
    And a rung this install never reached is reported as null rather than left out
