Feature: End-to-end validation after `npx @langwatch/server` boots
  As a user (and as a CI job)
  I want to know every service is reachable and the core flows work
  So that "all services healthy" is not a lie

  See _shared/contract.md §13 for the definition of done.

  Background:
    Given `npx @langwatch/server` has booted to "all services healthy"
    And the resolved port-base is 5560

  # =========================================================================
  # Service reachability
  # =========================================================================

  Scenario: Every service exposes a health endpoint that returns 200
    When I curl each of:
      | url                                  |
      | http://localhost:5560/api/health     |
      | http://localhost:5561/health         |
      | http://localhost:5562/health         |
      | http://localhost:5563/healthz        |
    Then every response status is 200

  Scenario: Postgres is reachable with the generated DATABASE_URL
    When I run "psql ${DATABASE_URL} -c 'select 1'"
    Then exit code is 0 and stdout contains "1"

  Scenario: ClickHouse is reachable with the generated CLICKHOUSE_URL
    When I run "curl ${CLICKHOUSE_URL%/*}/?query=SELECT+1"
    Then response body is "1\n"

  Scenario: Redis is reachable with the generated REDIS_URL
    When I run "redis-cli -u ${REDIS_URL} ping"
    Then stdout is "PONG"

  # =========================================================================
  # First-time signup (no auth provider configured)
  # =========================================================================

  Scenario: Default email-provider lets the user create an account
    Given NEXTAUTH_PROVIDER is "email"
    When I POST to /api/auth/signin with {"email":"founder@example.com"}
    Then I am issued a session cookie
    And GET /api/me returns 200 with {"email":"founder@example.com"}

  Scenario: Project is auto-created on first signup
    Given I am newly signed in
    When I GET /api/projects
    Then the response contains exactly one project
    And that project has a generated API key

  # =========================================================================
  # Critical full-stack paths
  # =========================================================================

  Scenario: A workflow execution hits langwatch_nlp end-to-end
    Given I am signed in with project "p1"
    When I POST a workflow with one LLM node to /api/workflows/execute
    Then the response status is 200
    And ~/.langwatch/logs/<today>/langwatch_nlp.log contains "POST /workflow"
    And the trace appears in /api/traces within 5 seconds

  Scenario: An evaluator hits langevals end-to-end
    Given I am signed in with project "p1"
    When I POST to /api/evaluations/run with evaluator "langevals/ragas/answer_relevancy"
    Then the response status is 200
    And ~/.langwatch/logs/<today>/langevals.log contains "POST /evaluations/ragas"
    And the result is persisted to clickhouse

  Scenario: A chat completion through the AI Gateway records a trace
    Given I am signed in with project "p1" and have created a virtual key "lw_vk_test_xxx"
    When I POST a chat completion to http://localhost:5563/v1/chat/completions with that virtual key
    Then the response is a valid OpenAI completion JSON
    And a trace appears in /api/traces with attribute "langwatch.origin=ai_gateway"

  # =========================================================================
  # Browser-driven QA (julia)
  # =========================================================================

  @browser-qa
  Scenario: A real browser can sign up and load the home dashboard
    Given the CLI auto-opened http://localhost:5560
    When I sign up as "founder@example.com" via the email form
    Then I land on the project home with no console errors
    And the page header reads "LangWatch"

  @browser-qa
  Scenario: Workflow studio loads and renders the canvas
    Given I am signed in
    When I navigate to /studio
    Then the workflow studio canvas renders with at least the "Input" and "Output" nodes
    And no XHR returns 5xx

  @browser-qa
  Scenario: Evaluations v3 page loads with at least one evaluator catalog entry
    Given I am signed in
    When I navigate to /evaluations
    Then the evaluator catalog shows entries
    And clicking an entry opens its config drawer

  @browser-qa
  Scenario: AI Gateway menu is visible (FF-forced) and lists the local provider
    Given the CLI sets FEATURE_FLAG_FORCE_ENABLE=release_ui_ai_gateway_menu_enabled
    When I navigate to /ai-gateway
    Then the page renders without 500
    And I can see the "Virtual Keys" section

  # =========================================================================
  # CI smoke (machine-driven)
  # =========================================================================

  @ci
  Scenario: CI smoke test asserts every step in under 5 minutes
    Given a fresh sandbox dir
    When CI runs `npx @langwatch/server --no-open --port 5560` with CI=1
    Then within 300 seconds the entire validation set above passes
    And on failure, ~/.langwatch/logs/ is uploaded as a workflow artifact

  # =========================================================================
  # Failure modes (observable, not silent)
  # =========================================================================

  Scenario: Missing OPENAI_API_KEY does not crash, but evaluator scenarios are gated
    Given the user has no "OPENAI_API_KEY" in their env
    When I navigate to /evaluations and try to run an LLM-as-judge evaluator
    Then I see an inline banner: "Set OPENAI_API_KEY to run this evaluator"
    But the rest of the app remains functional

  Scenario: Disk-full when scaffolding ~/.langwatch fails loudly
    Given "~/.langwatch" is on a full filesystem
    When the CLI runs the env-scaffold step
    Then the CLI prints "ENOSPC: disk full at ~/.langwatch — free space and re-run."
    And the CLI exits with code 1
