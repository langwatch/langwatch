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
  #   langwatch test-suite run --wait      polled GET /api/scenario-events?batchRunId=
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

  # The template commands sent the device access token to the management API
  # (`/api/v1/governance/ingestion-templates`), which takes an API key and the
  # project it acts in, so every one of them answered "Session expired". Past
  # that, `admin-list` read `ingestion_templates` from a route that answers
  # `{ data: [...] }`, and `archive` typed its answer as `{ ok: true }`; the
  # route answers `{ archived: true }`.
  Scenario: Template commands sign in with the login key in its project
    Given a device login
    When the CLI reads an ingestion template
    Then it sends the login key and the project it acts in
    And not the device access token

  Scenario: Listing templates as an admin returns every row the app answers with
    Given the admin template list route answers with two templates
    When the CLI lists ingestion templates as an admin
    Then it returns both templates

  Scenario: Archiving a template reads the answer the app sends
    Given an org-authored ingestion template
    When the CLI archives it
    Then it reports the template as archived
