Feature: CI reports a pull request's deployment impact from its diff
  As an operator upgrading a LangWatch install
  I want every pull request's deployment impact read from the code
  So that what breaks an install is caught by a check, not left to a writeup

  # This replaces the hand-written "## Deployment Impact" section. The section
  # was graded by length and keywords, so it said nothing a check could hold
  # to. The report is computed from the diff, posted on the pull request's
  # impact map, and blocks only on a fact that breaks an existing install.
  # A maintainer clears a block with the `operator-action` label, which says
  # the release notes must tell operators what to do.

  Rule: a fact that breaks an existing install blocks the pull request

    @unit
    Scenario: A new environment variable with no default blocks
      Given a pull request adds a setting read from an environment variable
      And the setting has no default and is not optional
      And no chart sets the variable
      When the report is computed
      Then it names the variable as required on upgrade
      And the pull request is blocked

    @unit
    Scenario: A setting that becomes required blocks
      Given a setting that was optional before the pull request
      And the pull request makes it required
      When the report is computed
      Then the pull request is blocked

    @unit
    Scenario: A required variable the chart sets does not block
      Given a pull request adds a required setting
      And a chart sets that variable
      When the report is computed
      Then the variable is listed
      And the pull request is not blocked

    @unit
    Scenario: A required Go service setting blocks
      Given a pull request adds a Go config field tagged as required
      When the report is computed
      Then the pull request is blocked

    @unit
    Scenario: A removed helm value blocks
      Given a pull request removes or renames a key in a chart's values file
      When the report is computed
      Then it names the key an operator's override would no longer reach
      And the pull request is blocked

    @unit
    Scenario: A variable the code stopped reading but the chart still sets blocks
      Given a pull request removes the last read of an environment variable
      And a chart or .env.example still sets that variable
      When the report is computed
      Then it names the variable and where it is still set
      And the pull request is blocked

    @unit
    Scenario: A variable still read somewhere else does not block
      Given a pull request removes one setting's read of a variable
      And other code still reads the same variable
      When the report is computed
      Then the pull request is not blocked

    @unit
    Scenario: The operator-action label clears a block
      Given a report with a blocking fact
      And the pull request carries the operator-action label
      When the check runs
      Then it passes and the report says the block was acknowledged

  Rule: everything else is reported, never blocked

    @unit
    Scenario: Optional settings, new values and migrations are listed without blocking
      Given a pull request adds an optional setting, a new helm value and a migration
      When the report is computed
      Then each is listed in the report
      And the pull request is not blocked

    @unit
    Scenario: A pull request with no deployment facts says so
      Given a pull request that touches no setting, chart, migration or image
      When the report is computed
      Then the report says it has no deployment impact
