Feature: The registry of self-hosted installs
  Every daily usage report lands in a row of its own and updates one row per
  install, so LangWatch can answer who runs it, which release they run, how far
  they got in getting started and what they do with it. Before this the report
  reached PostHog and no database, and no screen read it back.

  The report presents no credential, so it identifies an install and never a
  customer: the organization on an install's row comes from the license bound
  to that instance, which was resolved from a token the install presented, and
  never from a field in the posted body.

  As a LangWatch operator
  I want to see every install that reported, newest activity first
  So that I can tell a real deployment from a trial and talk to the company running it

  Background:
    Given the usage report receiver is reachable

  # ============================================================================
  # Writing a report down
  # ============================================================================

  @unit
  Scenario: The first report from an install creates its row
    Given an install that has never reported
    When its report arrives
    Then a row is created carrying the instance id it minted
    And the row records when the install was first seen and when it was last seen
    And the report itself is kept as one history row

  @unit
  Scenario: A later report updates the same row
    Given an install that reported yesterday
    When it reports again with a newer release
    Then its row still carries the day it was first seen
    And the row names the newer release
    And the number of reports it has sent goes up by one

  @unit
  Scenario: A report can never claim a customer
    Given a report whose body names an organization
    When the report arrives
    Then the row carries no organization
    And the organization on the row is only ever the one on the license bound to that instance

  @unit
  Scenario: A report from an install holding a license is attributed to its customer
    Given a license bound to this instance
    When the report arrives
    Then the row names that license and the customer organization it belongs to

  @unit
  Scenario: A customer who switched the optional category off is recorded as having done so
    Given an install reporting only the standard and operational categories
    When the report arrives
    Then the row records that the optional category is switched off
    And it carries no domains, no ladder and no usage counts

  @unit
  Scenario: Storage failing never refuses the report
    Given a database that refuses the write
    When the report arrives
    Then the install is answered as though it had landed
    And the failure is reported to error tracking

  # ============================================================================
  # Reading it back
  # ============================================================================

  @unit
  Scenario: Installs are listed by most recent activity
    Given three installs that last reported on different days
    When the list is read
    Then the one that reported most recently comes first

  @unit
  Scenario: An operator searches by domain, hostname, version or instance id
    Given an install whose users are on acme.test
    When the operator searches for acme.test
    Then that install is among the results
    And part of a hostname, a release or an instance id finds it too

  @unit
  Scenario: The drawer shows the ladder, the domains and the usage numbers
    When an operator opens an install
    Then the rungs it reached are shown with the day each was reached
    And the rungs it never reached are shown as never reached
    And the domains are shown with their counts
