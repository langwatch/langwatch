Feature: CI reports a pull request's deployment impact from its diff
  As an operator upgrading a LangWatch install
  I want every pull request's deployment impact read from the code
  So that what breaks an install is caught by a check, not left to a writeup

  # This replaces the hand-written "## Deployment Impact" section. The section
  # was graded by length and keywords, so it said nothing a check could hold
  # to. The report is computed from the diff, posted on the pull request's
  # impact map, and blocks only on a fact that breaks an existing install.
  # A maintainer clears a block with the `operator-action` label, and the
  # release that ships the pull request lists it for operators.
  #
  # Settings are not read yet: guessing from source text whether a new
  # environment variable is required blocked ordinary pull requests whose
  # defaults live in code, so settings wait for an exact source.

  Rule: a fact that breaks an existing install blocks the pull request

    @unit
    Scenario: A removed helm value blocks
      Given a pull request removes or renames a key in a chart's values file
      When the report is computed
      Then it names the key an operator's override would no longer reach
      And the pull request is blocked

    @unit
    Scenario: The operator-action label clears a block
      Given a report with a blocking fact
      And the pull request carries the operator-action label
      When the check runs
      Then it passes and the report says the block was acknowledged

  Rule: everything else is reported, never blocked

    @unit
    Scenario: New helm values, migrations and image changes are listed without blocking
      Given a pull request adds a helm value and a migration and changes an image build
      When the report is computed
      Then each is listed in the report
      And the pull request is not blocked

    @unit
    Scenario: A pull request with no deployment facts says so
      Given a pull request that touches no chart value, migration or image
      When the report is computed
      Then the report says it has no deployment impact

  Rule: a release lists the pull requests that need operator action

    @unit
    Scenario: A release names the operator-action pull requests it ships
      Given a release whose changelog links pull requests
      And some of them carry the operator-action label
      When the release is published
      Then its notes gain an "Operator action required" section listing those pull requests

    @unit
    Scenario: A release with no operator-action pull request is left as it is
      Given a release whose changelog links no labelled pull request
      When the release is published
      Then its notes are unchanged

    @unit
    Scenario: Publishing the notes twice does not repeat the section
      Given a release whose notes already hold the section
      When the section is written again
      Then the notes hold it once, up to date
