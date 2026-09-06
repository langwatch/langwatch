@unit
Feature: The experiments REST API is published in the API reference
  As a developer automating experiments without the SDK
  I want the experiment endpoints documented like every other resource
  So that I can create, run, and read experiments straight over HTTP

  # The full round trip an integrator needs, and where each call lives:
  #
  #   POST /api/experiment/init                      create or look up by slug
  #   GET  /api/experiments                          list, with run counts
  #   POST /api/experiments/{slug}/run               start a run
  #   GET  /api/experiments/runs                     runs for one experiment
  #   GET  /api/experiments/runs/{runId}             poll one run
  #   GET  /api/experiments/runs/{runId}/results     per-row results
  #
  # `init` is the one the SDKs call first: both batch evaluation and the
  # experiment context manager POST it before they report a single result.
  # It was the only step with no documented HTTP equivalent, which made the
  # whole flow look SDK-only from the outside.

  Scenario: Creating an experiment is documented
    When I read the generated OpenAPI document
    Then POST /api/experiment/init declares a request body
    And it declares a 2xx response carrying a schema

  Scenario Outline: Every experiment endpoint is in the document
    When I read the generated OpenAPI document
    Then the operation <method> <path> is present

    Examples:
      | method | path                                     |
      | POST   | /api/experiment/init                     |
      | GET    | /api/experiments                         |
      | POST   | /api/experiments/{slug}/run              |
      | GET    | /api/experiments/runs                    |
      | GET    | /api/experiments/runs/{runId}            |
      | GET    | /api/experiments/runs/{runId}/results    |

  Scenario: Experiments have a reference section a reader can navigate to
    When the API reference pages are generated
    Then an Experiments group owns every /api/experiment path
    And no experiment path is listed as undocumented

  Scenario: The session-only execution endpoints stay unpublished
    Given execute and abort authenticate with a browser session, not an API key
    When I read the generated OpenAPI document
    Then POST /api/experiments/execute is absent
    And POST /api/experiments/abort is absent
