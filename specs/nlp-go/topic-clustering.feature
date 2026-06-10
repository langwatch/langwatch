Feature: Topic clustering runs on langevals
  As a LangWatch operator
  I want topic clustering jobs to run on langevals for every project
  So that the langwatch_nlp service can be deleted without orphaning the clustering pipeline

  # _shared/contract.md §1 + §11. Topic clustering is not rewritten in Go
  # (sklearn + scipy + the per-cluster LLM naming step are heavy and
  # language-bound). It lives in langevals (the Python evaluator service that
  # stays). With langwatch_nlp removed, there is no host-selection flag left:
  # the TS app always routes topic clustering to langevals. The algorithm and
  # request/response shapes are unchanged.

  # All @unimplemented scenarios describe TS routing in
  # langwatch/src/server/topicClustering/topicClustering.ts (always langevals,
  # warn-and-skip when unconfigured, engine attribution log). Existing tests in
  # topicClustering.unit.test.ts + .integration.test.ts cover ClickHouse query
  # behavior. Aspirational pending dedicated routing tests.

  Background:
    Given the langevals service is reachable at ${LANGEVALS_ENDPOINT}
    And langevals serves POST /topics/batch_clustering and POST /topics/incremental_clustering
    And a project "acme-api" exists with an embedding model + chat model configured

  # ============================================================================
  # Routing — always langevals, no flag, no langwatch_nlp
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: batch clustering routes to langevals for every project
    When the topic-clustering worker calls fetchTopicsBatchClustering for "acme-api"
    Then the request POSTs to "${LANGEVALS_ENDPOINT}/topics/batch_clustering"
    And the request body shape is unchanged (BatchClusteringParams)
    And the response shape is TopicClusteringResponse

  @integration @v1 @unimplemented
  Scenario: incremental clustering routes to langevals for every project
    When the topic-clustering worker calls fetchTopicsIncrementalClustering for "acme-api"
    Then the request POSTs to "${LANGEVALS_ENDPOINT}/topics/incremental_clustering"

  @integration @v1 @unimplemented
  Scenario: there is no langwatch_nlp fallback and no TOPIC_CLUSTERING_SERVICE
    When the topic-clustering worker resolves where to send a job
    Then it never considers langwatch_nlp or TOPIC_CLUSTERING_SERVICE
    And the only host it can target is langevals

  # ============================================================================
  # Configuration — what env var matters and how the worker degrades
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: missing LANGEVALS_ENDPOINT skips clustering with a warning, does not error
    Given the env var LANGEVALS_ENDPOINT is unset
    When the worker calls fetchTopicsBatchClustering for "acme-api"
    Then the function returns undefined
    And a warning is logged with projectId and the reason "service URL not set"
    And no exception is thrown to the worker queue

  # ============================================================================
  # Observability — operators can see the job ran on langevals
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: every clustering call logs the engine that served it
    When fetchTopicsBatchClustering completes for any project
    Then the access log line carries an "engine" field with value "langevals"
    And errors include the engine name so failures are attributable

  # ============================================================================
  # Provider credentials — the litellm_params payload travels with the request
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: the litellm_params payload is accepted by langevals
    Given a BatchClusteringParams with litellm_params for the project's chat model
    And embeddings_litellm_params for the project's embedding model
    When the request is sent to langevals
    Then langevals uses the embedded credentials to call the user's configured providers
    # The credentials envelope is unchanged. See _shared/contract.md §9.

  # ============================================================================
  # Deployment — langevals lambda runs the Python clustering code, sized for it
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: the langevals topic_clustering lambda has memory tier 3072MB
    When the operator inspects the deployed lambda
    Then aws_lambda_function for evaluator_package "topic_clustering" has memory_size 3072
    # sklearn + scipy + numpy + per-cluster LLM calls measured ~2.7GB peak
    # during a 5k-trace batch run; the default 256MB would OOM.

  @integration @v1 @unimplemented
  Scenario: the langevals package register_routes hook only mounts when installed
    Given a langevals lambda built without the topic_clustering extra
    When the FastAPI app starts up
    Then no routes for /topics/batch_clustering or /topics/incremental_clustering exist
    And per-evaluator routes (e.g. /langevals/basic/evaluate) work as today
