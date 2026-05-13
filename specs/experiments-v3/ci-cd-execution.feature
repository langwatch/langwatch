@integration
Feature: CI/CD Execution of Platform Evaluations
  As a developer
  I want to run my platform-configured evaluations from CI/CD pipelines
  So that I can automate quality checks on my LLM applications

  # 6 scenarios bound to cicd-execution.integration.test.ts (auth headers,
  # 404 lookups, runId polling). Remaining @unimplemented scenarios need an
  # SSE event-stream test harness (target_result/evaluator_result/done events)
  # plus error-text rewrites flagged in AUDIT_MANIFEST.md ("Missing API key" vs
  # actual "Missing credentials"). Aspirational pending those follow-ups.

  Background:
    Given a project with API key "test-api-key"
    And a saved Evaluations V3 experiment "my-evaluation" with:
      | targets    | gpt-4-prompt                    |
      | evaluators | exact_match, ragas/faithfulness |
      | dataset    | 3 rows                          |

  # ==========================================================================
  # Authentication
  # ==========================================================================

  Scenario: API key authentication via X-Auth-Token header
    Given a valid API key in the X-Auth-Token header
    When I POST to /api/experiments/my-evaluation/run
    Then I receive 200 OK
    And the response contains a runId

  Scenario: API key authentication via Authorization Bearer header
    Given a valid API key in the Authorization header as "Bearer {key}"
    When I POST to /api/experiments/my-evaluation/run
    Then I receive 200 OK

  @unimplemented
  Scenario: Missing API key returns 401
    Given no API key header
    When I POST to /api/experiments/my-evaluation/run
    Then I receive 401 Unauthorized
    And the response contains error "Missing API key"

  @unimplemented
  Scenario: Invalid API key returns 401
    Given an invalid API key "bad-key"
    When I POST to /api/experiments/my-evaluation/run
    Then I receive 401 Unauthorized
    And the response contains error "Invalid API key"

  # ==========================================================================
  # Loading Saved Evaluation
  # ==========================================================================

  @unimplemented
  Scenario: Load evaluation by slug
    When I POST to /api/experiments/my-evaluation/run
    Then the backend loads experiment with slug "my-evaluation"
    And extracts targets, evaluators, and dataset from workbenchState

  Scenario: Evaluation not found returns 404
    When I POST to /api/experiments/non-existent/run
    Then I receive 404 Not Found
    And the response contains error "Evaluation not found"

  @unimplemented
  Scenario: Evaluation belongs to different project returns 404
    Given "other-evaluation" belongs to a different project
    When I POST to /api/experiments/other-evaluation/run
    Then I receive 404 Not Found

  # ==========================================================================
  # Polling Mode (Default)
  # ==========================================================================

  Scenario: Default response returns runId for polling
    When I POST to /api/experiments/my-evaluation/run
    Then I receive 200 OK with Content-Type "application/json"
    And the response contains:
      | field  | type   |
      | runId  | string |
      | status | string |

  @unimplemented
  Scenario: Poll for run status while running
    Given I started a run and received runId "run_abc123"
    When I GET /api/experiments/runs/run_abc123
    Then I receive 200 OK
    And the response contains:
      | field    | value   |
      | status   | running |
      | progress | number  |
      | total    | number  |

  Scenario: Poll for run status when completed
    Given run "run_abc123" has completed
    When I GET /api/experiments/runs/run_abc123
    Then I receive 200 OK
    And the response contains:
      | field   | value     |
      | status  | completed |
      | summary | object    |

  Scenario: Poll for non-existent run returns 404
    When I GET /api/experiments/runs/non-existent
    Then I receive 404 Not Found

  # ==========================================================================
  # SSE Streaming Mode
  # ==========================================================================

  @unimplemented
  Scenario: SSE mode with Accept header
    Given the request has header "Accept: text/event-stream"
    When I POST to /api/experiments/my-evaluation/run
    Then I receive 200 OK with Content-Type "text/event-stream"
    And events are streamed as execution progresses

  @unimplemented
  Scenario: SSE emits execution_started event
    Given SSE mode is enabled
    When execution starts
    Then I receive SSE event:
      | type    | execution_started |
      | runId   | string            |
      | total   | 3                 |

  @unimplemented
  Scenario: SSE emits progress events
    Given SSE mode is enabled
    When a cell completes
    Then I receive SSE event:
      | type      | progress |
      | completed | number   |
      | total     | number   |

  @unimplemented
  Scenario: SSE emits target_result events
    Given SSE mode is enabled
    When a target execution completes
    Then I receive SSE event:
      | type     | target_result |
      | targetId | string        |
      | rowIndex | number        |
      | output   | string        |

  @unimplemented
  Scenario: SSE emits evaluator_result events
    Given SSE mode is enabled
    When an evaluator completes
    Then I receive SSE event:
      | type        | evaluator_result |
      | targetId    | string           |
      | evaluatorId | string           |
      | passed      | boolean          |

  @unimplemented
  Scenario: SSE emits done event with summary
    Given SSE mode is enabled
    When execution completes
    Then I receive SSE event:
      | type    | done   |
      | summary | object |

  # ==========================================================================
  # Error Handling
  # ==========================================================================

  @unimplemented
  Scenario: Target execution error is captured
    Given target "gpt-4-prompt" fails with "API key invalid"
    When execution completes
    Then the summary shows target "gpt-4-prompt" with errors
    And other targets continue executing

  @unimplemented
  Scenario: Evaluator error is captured
    Given evaluator "exact_match" fails for row 1
    When execution completes
    Then the summary shows evaluator "exact_match" with errors
    And other evaluators continue executing

  @unimplemented
  Scenario: Run status shows error state
    Given all targets failed
    When I poll for run status
    Then status is "failed"
    And summary includes error details

  # ==========================================================================
  # Results Storage
  # ==========================================================================

  @unimplemented
  Scenario: Results are saved to Elasticsearch
    When execution completes
    Then results are stored in Elasticsearch with:
      | field        | value                    |
      | project_id   | project's ID             |
      | experiment_id| evaluation's experiment ID|
      | run_id       | the generated runId      |

  @unimplemented
  Scenario: Run appears in evaluation history
    When execution completes
    Then the run appears in the evaluation's run history
    And can be viewed in the LangWatch UI
