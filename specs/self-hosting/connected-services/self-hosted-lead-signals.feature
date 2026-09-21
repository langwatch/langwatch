Feature: Lead signals from a self-hosted install
  A daily report from every install is a firehose, and a team that gets one
  message a day per install stops reading them. So five things are raised, each
  one something a person would act on, and each one raised once per install
  rather than once per report.

  No new vendor: the traits go on the customer's existing Customer.io object
  and the message goes to the existing Slack notifications.

  As someone talking to customers
  I want to hear when a self-hosted install does something worth a conversation
  So that I find out a company is running LangWatch before they churn or before they ask

  Background:
    Given a self-hosted install reporting daily

  # ============================================================================
  # What is worth raising
  # ============================================================================

  @unit
  Scenario: An install that grew past a team is raised
    Given an install reporting more users than a team has
    When its report arrives
    Then the seats signal is raised

  @unit
  Scenario: Ingestion is only raised once the install has been running a month
    Given an install ingesting heavily that was first seen yesterday
    When its report arrives
    Then the sustained ingestion signal is not raised
    But the same install a month later raises it

  @unit
  Scenario: A licensed feature running without a license is raised
    Given an install with single sign-on configured and no license bound
    When its report arrives
    Then the licensed feature signal is raised

  @unit
  Scenario: A license about to lapse is raised
    Given an install whose license ends in three weeks
    When its report arrives
    Then the expiring signal is raised
    And a license ending next year raises nothing

  @unit
  Scenario: A company that already has an account with us is raised
    Given an install whose users are on a domain with a LangWatch Cloud account
    When its report arrives
    Then the domain signal is raised

  @unit
  Scenario: A licensed install that stopped syncing is raised
    Given a connected install whose license last synced eight days ago
    When its report arrives
    Then the stale sync signal is raised
    And an install that synced yesterday raises nothing
    And a license that never synced raises nothing

  # ============================================================================
  # Not a firehose
  # ============================================================================

  @unit
  Scenario: A signal already raised is never raised again
    Given an install that already raised the seats signal
    When it reports the same size tomorrow
    Then no signal is raised

  @unit
  Scenario: The lookup for an already-raised signal is not made again
    Given an install that already raised the domain signal
    When its report arrives
    Then LangWatch Cloud is not asked about that domain again

  # ============================================================================
  # Where a raised signal goes
  # ============================================================================

  @unit
  Scenario: A raised signal reaches Slack with the install behind it
    Given an install raising the seats signal
    When the signal is announced
    Then a Slack message names the company, the release and the usage
    And it links to the install in the backoffice

  @unit
  Scenario: An install bound to a customer gets its traits on that customer
    Given an install whose license binds it to a customer organization
    When a signal is announced
    Then the customer's organization carries the install's release and usage as traits
    And one event is tracked per signal

  @unit
  Scenario: An install with no license reaches Slack and no CRM record
    Given an install bound to no customer
    When a signal is announced
    Then the Slack message is still sent
    And no traits are written, because there is no customer to write them on

  @unit
  Scenario: The CRM failing never fails the report
    Given a CRM that refuses the call
    When a signal is announced
    Then the failure is reported to error tracking and the report still stands
