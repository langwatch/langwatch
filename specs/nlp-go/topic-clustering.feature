Feature: Topic clustering migrates to langevals when the Go-engine flag is on
  As a LangWatch operator rolling out the Go NLP engine to projects gradually
  I want topic clustering jobs for flagged projects to run on langevals (Python+sklearn+LiteLLM)
  So that langwatch_nlp can be decommissioned without orphaning the clustering pipeline

  # _shared/contract.md §1 + §11. Topic clustering is intentionally NOT being
  # rewritten in Go (sklearn + scipy + the per-cluster LiteLLM naming step are
  # heavy and language-bound). Instead it moves hosting services: langwatch_nlp
  # is the legacy Python service we're shrinking; langevals is where Python
  # long-term lives. The Go-engine feature flag decides which host serves a
  # project's job — the algorithm and request shape stay byte-identical.

  Background:
    Given the langevals service is reachable at ${LANGEVALS_ENDPOINT}
    And the langwatch_nlp service is reachable at ${TOPIC_CLUSTERING_SERVICE}
    And both services serve POST /topics/batch_clustering and POST /topics/incremental_clustering
    And a project "acme-api" exists with an embedding model + chat model configured

  # ============================================================================
  # Path selection driven by release_nlp_go_engine_enabled
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: with the flag OFF, batch clustering hits the legacy langwatch_nlp host
    Given the flag "release_nlp_go_engine_enabled" is OFF for project "acme-api"
    When the topic-clustering worker calls fetchTopicsBatchClustering for "acme-api"
    Then the request POSTs to "${TOPIC_CLUSTERING_SERVICE}/topics/batch_clustering"
    And the request body shape is unchanged from today (BatchClusteringParams)
    And the response shape is TopicClusteringResponse

  @integration @v1 @unimplemented
  Scenario: with the flag ON, batch clustering hits langevals
    Given the flag is ON for project "acme-api"
    When the topic-clustering worker calls fetchTopicsBatchClustering for "acme-api"
    Then the request POSTs to "${LANGEVALS_ENDPOINT}/topics/batch_clustering"
    And the request body shape is unchanged from today (BatchClusteringParams)
    And the response shape is TopicClusteringResponse

  @integration @v1 @unimplemented
  Scenario: with the flag ON, incremental clustering hits langevals
    Given the flag is ON for project "acme-api"
    When the topic-clustering worker calls fetchTopicsIncrementalClustering for "acme-api"
    Then the request POSTs to "${LANGEVALS_ENDPOINT}/topics/incremental_clustering"

  @integration @v1 @unimplemented
  Scenario: with the flag OFF, incremental clustering stays on langwatch_nlp
    Given the flag is OFF for project "acme-api"
    When the topic-clustering worker calls fetchTopicsIncrementalClustering for "acme-api"
    Then the request POSTs to "${TOPIC_CLUSTERING_SERVICE}/topics/incremental_clustering"

  # ============================================================================
  # Result parity — the algorithm hasn't changed; both hosts produce the same answer
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: a deterministic input produces the same topics on both hosts
    Given a fixed seed and a fixed set of 200 traces with stable embeddings
    When the same BatchClusteringParams are POSTed to both
        | host                          |
        | ${TOPIC_CLUSTERING_SERVICE}   |
        | ${LANGEVALS_ENDPOINT}         |
    Then both hosts return the same number of topics
    And the topic membership for every trace is identical
    And the per-trace cosine-distance values match within tolerance 1e-6
    # Drift in topic *names* across hosts is acceptable (LLM-driven, non-deterministic
    # by design) — assertion is on cluster structure, not labels.

  # ============================================================================
  # Configuration — what env vars matter and how the TS app picks the host
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: missing LANGEVALS_ENDPOINT skips clustering with a warning, does not error
    Given the flag is ON for project "acme-api"
    And the env var LANGEVALS_ENDPOINT is unset
    When the worker calls fetchTopicsBatchClustering for "acme-api"
    Then the function returns undefined
    And a warning is logged with projectId and the reason "service URL not set"
    And no exception is thrown to the worker queue

  @integration @v1 @unimplemented
  Scenario: missing TOPIC_CLUSTERING_SERVICE on the legacy path skips clustering with a warning
    Given the flag is OFF for project "acme-api"
    And the env var TOPIC_CLUSTERING_SERVICE is unset
    When the worker calls fetchTopicsBatchClustering for "acme-api"
    Then the function returns undefined
    And a warning is logged with projectId

  # ============================================================================
  # Observability — operators can see which host served the job
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: every clustering call logs which engine served it
    When fetchTopicsBatchClustering completes for any project
    Then the access log line carries an "engine" field with value "langevals" or "langwatch_nlp"
    And errors include the engine name in the error message so failures are attributable

  # ============================================================================
  # Provider credentials — the litellm_params payload travels with the request
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: the same litellm_params payload format is accepted by both hosts
    Given a BatchClusteringParams with litellm_params for the project's chat model
    And embeddings_litellm_params for the project's embedding model
    When the request is sent to either host
    Then both hosts use the embedded credentials to call the user's configured providers
    # Same LiteLLM behaviour, same env-var injection — the migration moves only
    # the host, not the credentials envelope. See specs/nlp-go/_shared/contract.md §9.

  # ============================================================================
  # Deployment — langevals lambda runs the same Python code, sized appropriately
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: the langevals topic_clustering lambda has memory tier 3072MB
    When the operator inspects the deployed lambda
    Then aws_lambda_function for evaluator_package "topic_clustering" has memory_size 3072
    # sklearn + scipy + numpy + per-cluster LiteLLM calls measured ~2.7GB peak
    # during a 5k-trace batch run; the existing default of 256MB would OOM.

  @integration @v1 @unimplemented
  Scenario: the langevals package register_routes hook only mounts when installed
    Given a langevals lambda built without the topic_clustering extra
    When the FastAPI app starts up
    Then no routes for /topics/batch_clustering or /topics/incremental_clustering exist
    And per-evaluator routes (e.g. /langevals/basic/evaluate) work as today
    # Per-evaluator Lambda deploys (--extra openai / --extra ragas) keep working
    # — topic_clustering is opt-in via --extra topic_clustering or --extra all.

  # ============================================================================
  # Migration safety — flagging a project off mid-run does not cancel work
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: flipping the flag during a queued clustering job does not break it
    Given the flag was ON when the worker dequeued a job for "acme-api"
    And the worker has already POSTed to ${LANGEVALS_ENDPOINT}/topics/batch_clustering
    When the operator turns the flag OFF for "acme-api"
    Then the in-flight langevals call completes and its result is stored
    And the *next* clustering job for "acme-api" routes back to ${TOPIC_CLUSTERING_SERVICE}
