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

  @unimplemented @unit
  Scenario: The onboarding ladder records the day each rung was first reached
    When the report is taken
    Then each rung carries the day it was first reached
    And a rung this install never reached is reported as null rather than left out
