Feature: Python langwatch_nlp removed — nlpgo is the sole NLP engine
  As a LangWatch operator and a Studio user
  I want the NLP service to be a single Go process with no Python service
  So that the deployable artifact is light, boots fast, and there is one engine to reason about

  # _shared/contract.md §1-3, §7, §11 (Go-only end state). The Python
  # langwatch_nlp service, the uvicorn child, the front-door reverse proxy,
  # and the release_nlp_go_engine_enabled dual-path are all removed. nlpgo
  # serves /go/* + health in-process and returns a typed 502 for anything
  # else. The only Python that runs is a transient code-block sandbox
  # subprocess (§7).
  #
  # Scenarios are @unimplemented for the feature-parity checker: container
  # topology, image contents, and lambda packaging are verified by Go
  # integration tests under services/nlpgo/ + dockerfile/helm lint + the
  # lw-dev dogfood, none of which the TS-test-root checker scans. They are
  # the source of intent for those checks.

  # ============================================================================
  # The artifact is Go-only at the application layer
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: the NLP image contains no Python service or framework
    Given the self-hosted "langwatch_nlp" image is built from Dockerfile.langwatch_nlp
    When an operator inspects the image
    Then it contains the nlpgo Go binary
    And it contains a python3 interpreter only for the code-block sandbox
    And it does NOT contain uvicorn, fastapi, litellm, dspy, or the langwatch_nlp package
    And there is no uvicorn process and no second listening port

  @integration @v1 @unimplemented
  Scenario: the container runs a single Go process
    When the container starts
    Then nlpgo is the only long-lived process
    And it binds exactly one port
    And no child service process is spawned at startup

  # ============================================================================
  # Routing — every project uses nlpgo, no engine flag
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: studio execution always routes to the Go engine
    When the TS app runs a workflow for any project
    Then it POSTs to "${LANGWATCH_NLP_SERVICE}/go/studio/execute_sync"
    And there is no legacy non-/go path and no per-project engine flag check

  @integration @v1 @unimplemented
  Scenario: the playground proxy always routes to the Go dispatcher
    When the TS app proxies a playground completion for any project
    Then it forwards to "${LANGWATCH_NLP_SERVICE}/go/proxy/v1/..."
    And no request is sent to a Python LiteLLM proxy

  @integration @v1 @unimplemented
  Scenario: topic clustering always runs on langevals
    When the topic-clustering worker runs for any project
    Then it POSTs to "${LANGEVALS_ENDPOINT}/topics/batch_clustering" or "/topics/incremental_clustering"
    And it never targets langwatch_nlp
    And if LANGEVALS_ENDPOINT is unset the worker warns and skips (no langwatch_nlp fallback)

  @integration @v1 @unimplemented
  Scenario: a non-/go path returns a clear go-only error instead of proxying
    Given nlpgo is running
    When a request hits a legacy path like "/studio/execute_sync" or "/proxy/v1/chat/completions"
    Then nlpgo returns 502 with a body explaining it is in go-only mode and only serves /go/*
    And no reverse proxy hop is attempted

  # ============================================================================
  # Code blocks still run Python (feature parity preserved)
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: a code block runs user Python via the embedded sandbox
    Given a workflow with a code-block node
    When nlpgo executes the node
    Then it spawns a transient "python3 runner.py" subprocess
    And the runner and its dspy stub are materialized from the binary (no files copied into the image)
    And the subprocess is killed when the node finishes or the timeout elapses

  @integration @v1 @unimplemented
  Scenario: the curated sandbox libraries are importable in user code
    Given the sandbox python has sandbox-requirements.txt installed
    When user code imports "requests", "httpx", "pydantic", or "langwatch"
    Then the import succeeds
    When user code imports a package not in the curated set (for example "pandas")
    Then it raises ModuleNotFoundError, matching the documented available set

  # ============================================================================
  # No emergency Python fallback
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: there is no NLPGO_BYPASS lever anymore
    Given there is no Python service to fall back to
    When the container is configured
    Then NLPGO_BYPASS has no effect and the dual-process entry script is gone
    And the only way to run the NLP service is the Go binary
