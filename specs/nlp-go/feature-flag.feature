Feature: TS app routes to nlpgo via release_nlp_go_engine_enabled
  As a LangWatch operator rolling out the Go NLP engine to projects gradually
  I want a single feature flag to switch a project's NLP traffic to /go/* with HMAC signing
  So that I can canary, observe, and roll back without code deploys

  # _shared/contract.md §11. The flag flips routing for runWorkflow + playground.
  # Topic clustering is intentionally NOT gated by this flag (see §11). Distinct id
  # is projectId so the flag rolls out per-project. Env override mirrors PostHog.

  Background:
    Given the langwatch app is running with featureFlagService configured
    And the AI Gateway is reachable
    And a project "acme-api" exists with valid model providers configured

  # ============================================================================
  # Default-off + per-project enablement
  # ============================================================================

  @integration @v1
  Scenario: with the flag off, a workflow run goes to the legacy Python path unchanged
    Given the flag "release_nlp_go_engine_enabled" is OFF for project "acme-api"
    When the TS app calls runWorkflow for project "acme-api"
    Then the TS app POSTs to "${LANGWATCH_NLP_SERVICE}/studio/execute_sync"
    And the request has no "X-LangWatch-NLPGO-Signature" header
    And the request body is bit-identical to today's traffic shape

  @integration @v1
  Scenario: with the flag on for one project, only that project's runs go to /go/*
    Given the flag is ON for project "acme-api"
    And the flag is OFF for project "other-project"
    When runWorkflow is called for "acme-api"
    Then the TS app POSTs to "${LANGWATCH_NLP_SERVICE}/go/studio/execute_sync"
    When runWorkflow is called for "other-project"
    Then that request POSTs to "${LANGWATCH_NLP_SERVICE}/studio/execute_sync" (no /go prefix)

  # ============================================================================
  # Flag also gates the playground proxy path
  # ============================================================================

  @integration @v1
  Scenario: playground proxy traffic is also gated by the same flag, per-project
    Given the flag is ON for project "acme-api"
    When the playground for "acme-api" calls /api/proxy/v1/chat/completions
    Then the TS app forwards to "${LANGWATCH_NLP_SERVICE}/go/proxy/v1/chat/completions"
    And the request is signed with LW_NLPGO_INTERNAL_SECRET
    And every "x-litellm-*" header from the playground client is preserved on the outbound request

  # ============================================================================
  # Topic clustering is NOT gated
  # ============================================================================

  @integration @v1
  Scenario: topic clustering jobs always hit the legacy Python path regardless of the flag
    Given the flag is ON for project "acme-api"
    When the topic-clustering worker calls fetchTopicsBatchClustering for project "acme-api"
    Then the request POSTs to "${TOPIC_CLUSTERING_SERVICE}/topics/batch_clustering" (no /go prefix)
    And the request is unsigned (no X-LangWatch-NLPGO-Signature)

  # ============================================================================
  # Env-var overrides mirror existing PostHog conventions
  # ============================================================================

  @integration @v1
  Scenario: RELEASE_NLP_GO_ENGINE_ENABLED=1 forces the flag on globally regardless of PostHog
    Given the env var "RELEASE_NLP_GO_ENGINE_ENABLED=1" is set
    And PostHog reports the flag as OFF for project "acme-api"
    When runWorkflow is called for "acme-api"
    Then the TS app POSTs to "/go/studio/execute_sync"

  @integration @v1
  Scenario: FEATURE_FLAG_FORCE_ENABLE includes the flag and turns it on globally
    Given the env var "FEATURE_FLAG_FORCE_ENABLE=other_flag,release_nlp_go_engine_enabled,third_flag" is set
    When runWorkflow runs for any project
    Then the TS app routes via /go/*

  # ============================================================================
  # Workflow-level fall-back when Go engine doesn't support the workflow
  # ============================================================================

  @integration @v1
  Scenario: workflow containing an unsupported node kind falls back to Python even when flag is ON
    Given the flag is ON for project "acme-api"
    And a workflow contains a node of kind "evaluator" (not in nlpgo v1)
    When runWorkflow is called
    Then the TS app sends the request to "/go/studio/execute_sync"
    And nlpgo returns 501 with body.type "unsupported_node_kind"
    And the TS app retries the request to "/studio/execute_sync" (legacy path) without the flag header
    And the workflow result returns successfully via Python

  # ============================================================================
  # Observability — operators can see which path served a request
  # ============================================================================

  @integration @v1
  Scenario: every workflow run is tagged with the path that served it
    When runWorkflow completes for project "acme-api"
    Then the resulting LangWatch trace span has attribute "langwatch.nlp_engine" = "go" or "python"
    And the value matches whether /go/* or the legacy path was used

  # ============================================================================
  # Per-org / per-team rollout via PostHog group analytics
  # ============================================================================

  @integration @v1
  Scenario: flag evaluation passes projectId, organizationId, teamId for PostHog group targeting
    Given a project "acme-api" in organization "acme" team "platform"
    When the TS app evaluates "release_nlp_go_engine_enabled"
    Then the call to featureFlagService.isEnabled passes options { projectId: "acme-api", organizationId: "acme", teamId: "platform" }
    And PostHog can target the flag by any of those three groups

  # ============================================================================
  # Kill switch — flipping the flag off mid-traffic stops new /go/* traffic
  # ============================================================================

  @integration @v1
  Scenario: flipping the flag off does not abort in-flight workflows but stops new ones from going /go/*
    Given the flag is ON for "acme-api" and a workflow is running
    When the operator turns the flag OFF for "acme-api"
    Then in-flight workflow continues to completion on the Go path
    And the next runWorkflow for "acme-api" goes to the legacy /studio/execute_sync path

  # ============================================================================
  # Optimization is dead when the flag is on (no DSPy, no optimization)
  # ============================================================================

  @integration @v1
  Scenario: Studio "Optimize" button is hidden when the flag is ON for the project
    Given the flag "release_nlp_go_engine_enabled" is ON for project "acme-api"
    When a user opens a workflow in Studio for project "acme-api"
    Then the "Optimize" button is not rendered in the toolbar
    And the keyboard shortcut for optimize is unbound for this project

  @integration @v1
  Scenario: Studio "Optimize" button stays visible when the flag is OFF
    Given the flag is OFF for project "other-project"
    When a user opens a workflow in Studio for "other-project"
    Then the "Optimize" button is rendered as today

  @integration @v1
  Scenario: optimize endpoint returns 410 Gone when called for a flagged project
    Given the flag is ON for project "acme-api"
    When the TS app receives POST /api/workflows/optimize for project "acme-api"
    Then the response status is 410
    And the response body.type is "optimize_disabled"
    And the response body.message contains "Optimization is no longer supported on the Go engine"

  @integration @v1
  Scenario: optimize endpoint still works for projects on the legacy path
    Given the flag is OFF for project "legacy-project"
    When the TS app receives POST /api/workflows/optimize for "legacy-project"
    Then the response status is 200 (or whatever the legacy DSPy path returned)
    And the optimization run proceeds via the Python service

  @integration @v1
  Scenario: nlpgo returns 501 if a workflow contains an "optimize" or any DSPy-only node kind
    Given a workflow contains a node of kind "optimize" (DSPy-only legacy)
    When the TS app POSTs to "/go/studio/execute_sync"
    Then nlpgo returns 501 with body.type "unsupported_node_kind"
    And the TS app surfaces a helpful error in the Studio UI: "Optimization is not available on the new engine"
