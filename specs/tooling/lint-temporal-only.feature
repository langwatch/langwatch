# The lint half of specs/dependencies/temporal-time.feature: that spec owns what
# @langwatch/time does, this one owns the rule that keeps Date out of everything
# else.

Feature: The linter keeps one clock
  As a platform maintainer
  I want the linter to refuse a newly minted Date in product source
  So that every moment the product computes with is a Temporal instant

  Background:
    Given the langwatch oxlint plugin runs over the workspace sources

  Rule: Every way of minting a Date is named with its Temporal replacement

    @unit
    Scenario: Minting the current moment as a Date is reported
      Given production source that calls new Date with no arguments
      When the rule runs
      Then it reports the call and says to read the clock through the time package instead

    @unit
    Scenario: Reading the clock through Date.now is reported
      Given production source that calls Date.now
      When the rule runs
      Then it reports the call and names the epoch milliseconds an instant carries

    @unit
    Scenario: Constructing a Date from a value is reported
      Given production source that builds a Date out of a stored value
      When the rule runs
      Then it reports the construction and names the instant conversions to use instead

    @unit
    Scenario: Parsing a moment through Date.parse is reported
      Given production source that calls Date.parse on an ISO string
      When the rule runs
      Then it reports the call and names the instant parse to use instead

    @unit
    Scenario: Building an epoch count through Date.UTC is reported
      Given production source that calls Date.UTC on calendar parts
      When the rule runs
      Then it reports the call and names the calendar construction to use instead

    @unit
    Scenario: A value typed Date is reported
      Given production source that declares a value with the type Date
      When the rule runs
      Then it reports the declaration by name and offers an instant or a wire string instead

  Rule: The boundaries that can only speak Date are left alone

    @unit
    Scenario: The named boundary helpers keep their Date
      Given a conversion written inside a function named toDate or fromDate
      When the rule runs
      Then it reports nothing

    @unit
    Scenario: The Prisma seam keeps its Date
      Given a repository under the Prisma seam that holds a Date
      When the rule runs
      Then it reports nothing

    @unit
    Scenario: The Postgres adapter keeps its Date
      Given a Postgres adapter that holds a Date
      When the rule runs
      Then it reports nothing

    @unit
    Scenario: Test files keep their Date fixtures
      Given a test file that builds a Date fixture
      When the rule runs
      Then it reports nothing

    @unit
    Scenario: The time package keeps its Date
      Given a file in the time package itself
      When the rule runs
      Then it reports nothing

    @unit
    Scenario: A member call on another object is left alone
      Given production source that calls now on an injected clock
      When the rule runs
      Then it reports nothing

  Rule: Existing debt is held on the register rather than switched off

    @unit
    Scenario: A file on the debt register is left alone
      Given a file carrying a temporal-only entry in the shared oxlint baseline
      When the rule runs
      Then it reports nothing
