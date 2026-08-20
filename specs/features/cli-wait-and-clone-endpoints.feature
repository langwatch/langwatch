@unit
Feature: CLI commands address endpoints the app actually serves
  As someone running LangWatch from CI
  I want the CLI to call routes that exist
  So that a command either does its job or tells me why, rather than failing
  against a URL nothing has ever answered

  # Two commands called paths no route serves. Neither was caught by anything:
  # the OpenAPI coverage gate compares registered routes to the document, and a
  # CLI reaching for a route that was never registered is invisible from both
  # sides of that comparison.
  #
  #   langwatch suite run --wait      polled GET /api/scenario-events?batchRunId=
  #   langwatch scenario run --wait   the same
  #   langwatch governance ingestion-templates clone-from-platform
  #                                   posted .../ingestion-templates/clone-from-platform
  #
  # `/api/scenario-events` registers two POSTs and a DELETE, and no GET at all.
  # The clone route is `/ingestion-templates/clone`, which is what both the
  # spec and the governance guide document.

  Scenario: Waiting on a batch polls the endpoint that serves it
    Given a batch of simulation runs is in progress
    When the CLI polls for the batch's progress
    Then it requests GET /api/simulation-runs with the batch id
    And it does not request a path the app never registered

  Scenario: A batch larger than one page is counted in full
    Given a batch holds more runs than the list endpoint returns per page
    When the CLI polls for the batch's progress
    Then it follows the cursor until there are no more pages
    And the total counts every run, not just the first page

  # Deployed servers only apply the batchRunId filter when scenarioSetId is
  # also present, and answer with the whole project's runs otherwise. A stale
  # in-progress run from an old batch then counts as in flight forever, and
  # the wait times out even though the batch finished in seconds.
  Scenario: Runs from other batches never count toward the wait
    Given the run list endpoint answers with runs from the whole project
    When the CLI polls for the batch's progress
    Then only runs carrying the batch's own id are tallied

  Scenario: A status endpoint that answers 404 ends the wait
    Given the run list endpoint answers 404
    When the CLI polls for the batch's progress
    Then the poll raises rather than reporting an empty batch as finished

  Scenario Outline: A run's state decides whether it counts as finished
    Given a run in state <state>
    When the CLI tallies the batch
    Then the run counts as <counted>

    Examples:
      | state       | counted     |
      | IN_PROGRESS | in flight   |
      | PENDING     | in flight   |
      | SUCCESS     | passed      |
      | FAILED      | failed      |
      | STALLED     | failed      |

  Scenario: Cloning a platform template posts to the documented route
    Given a platform-published ingestion template
    When the CLI clones it into the organization
    Then it posts to /api/governance/ingestion-templates/clone
