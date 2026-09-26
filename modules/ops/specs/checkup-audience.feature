Feature: Who reads what of the checkup
  The checkup's details name the install's hosts, ports, environment variables
  and versions, and the usage report counts every organization on the install.
  Install admins, the people on the ops back-office list, read all of it. Every
  other caller, an organization member or a project API key, reads each check's
  verdict and a usage report for their own organization.

  Background:
    Given a self-hosted install with two organizations

  @unit
  Scenario: An install admin reads what each check found and how to fix it
    Given the caller is on the ops back-office list
    When the checkup is read
    Then every row carries its verdict with its detail

  @unit
  Scenario: An organization member reads each check's verdict and nothing more
    Given the caller is signed in and not on the ops back-office list
    When the checkup is read and its paid checks are run
    Then every row carries its name, group, cost and outcome
    And no row carries a detail, fix, code or docs link

  @unit
  Scenario: A project API key is never an install admin
    Given the caller presents a project API key
    When the checkup is read over REST
    Then every row carries its outcome and no detail
    And the usage report carries no destination, switches or schedule

  @unit
  Scenario: An install admin reads the whole install's usage report
    Given the caller is on the ops back-office list
    When the usage report is read
    Then it names where the report goes, its switches and when it next goes

  @unit
  Scenario: An organization member reads a usage report for their own organization
    Given the caller is signed in and not on the ops back-office list
    When the usage report is read
    Then its figures count the caller's organization only
    And it carries no install identity, release, hostname or sign-in method

  @unit
  Scenario: An organization's report counts its own members' sign-ins and email domains
    Given the caller is signed in and not on the ops back-office list
    And members of another organization are signed in with other email domains
    When the usage report is read
    Then its signed-in users count the caller's organization's members only
    And its email domains count the caller's organization's members only

  @unit
  Scenario: An install admin changes what the install reports
    Given the caller is on the ops back-office list
    When the usage report switches are changed
    Then the switches are written
    And the whole install's report comes back with its switches

  @unit
  Scenario: Only an install admin changes what the install reports
    Given the caller is not on the ops back-office list
    When the usage report switches are changed
    Then the change is refused as operator-only
    And nothing is written

  @integration
  Scenario: The checkup page tells an organization member who can see the details
    Given the checkup answered verdicts only
    When the page renders a failing row and the usage report
    Then the row says the install administrator can see what it found
    And the usage report shows the organization's figures without the report switches
