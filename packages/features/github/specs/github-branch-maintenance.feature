Feature: GitHub branch linkage maintenance

  Pull-request linkage has two halves that were one service. Demand arrives
  with a project — a session is looking at a branch now — and the fleet-wide
  sweep arrives with nothing but a database, re-asking GitHub about branches
  that mapped to nothing and dropping bookkeeping nobody reads any more. While
  they were one service the sweep dragged an organization service and a project
  service behind it, so only a process that had composed the whole application
  could run it.

  @unit
  Scenario: The branch sweep runs without an organization or a project service
    Given a process holding only a database and GitHub App credentials
    When the sweep re-checks a branch that is due
    Then it resolves the installation covering the repository
    And it stores the pull requests GitHub answers with

  @unit
  Scenario: The branch sweep records what it found against the branch
    Given a branch that previously mapped to nothing
    When the sweep finds a pull request for it
    Then the branch is no longer marked as not found
    And no further re-check is scheduled for it

  @unit
  Scenario: The sweep reads a bounded page of branches demanded recently
    Given branch bookkeeping spanning every organization
    When the sweep asks which branches are due
    Then it asks only for branches that mapped to nothing, are due now, and were demanded inside the activity window
    And it takes a bounded page of them, oldest due first

  @unit
  Scenario: Branch bookkeeping is dropped past the activity horizon
    Given branch bookkeeping older than the activity horizon
    When the retention prune runs
    Then the bookkeeping is deleted
    And the pull requests themselves are kept

  @unit
  Scenario: A sweep without App credentials asks GitHub nothing
    Given a process with no GitHub App credentials
    When the sweep re-checks a branch that is due
    Then no request is made to GitHub
    And no branch bookkeeping is written

  @unit
  Scenario: The retention prune runs without App credentials
    Given a process with no GitHub App credentials
    When the retention prune runs
    Then the bookkeeping past the horizon is still deleted

  @unit
  Scenario: A demanded mapping that finds a pull request records project activity
    Given a project asks about a branch on a mappable host
    When the mapping finds a pull request
    Then the project is recorded as having seen coding-agent activity

  @unit
  Scenario: A demanded mapping that finds nothing leaves project activity alone
    Given a project asks about a branch on a mappable host
    When the mapping finds no pull request
    Then the project's activity is untouched

  @unit
  Scenario: A demanded branch is pulled into the active sweep window
    Given a project asks about a branch the sweep had backed off from
    When the request is handled
    Then the branch's next re-check is brought forward before it is mapped

  @unit
  Scenario: A failed project-activity write does not fail the mapping
    Given the project activity write fails
    When a demanded mapping finds a pull request
    Then the request completes and the failure is logged

  @unit
  Scenario: An unmappable repository host is never resolved to an organization
    Given a project asks about a branch on a host this instance cannot map
    When the request is handled
    Then no project lookup and no mapping happen

  @unit
  Scenario: The worker composes the branch sweep from the feature package
    Given a worker graph composed with the process database
    When the GitHub feature installs
    Then it registers the branch maintenance pipeline
    And the pipeline's prune reaps the outbox rows of this graph's own process store

  @unit
  Scenario: A worker without GitHub App credentials names the missing capability
    Given a worker graph composed without GitHub App credentials
    When the graph is composed
    Then the absence is reported by name
    And the sweep is still mounted, because its retention half needs no credentials
