Feature: Telemetry — every span carries the correct origin
  As a LangWatch operator debugging customer behavior across workflows, evaluations, playground, and topic clustering
  I want every nlpgo + AI-Gateway span to carry a langwatch.origin attribute that names the entrypoint
  So that I can filter "all spans served by a workflow run" or "all spans served by an evaluation" without ambiguity

  # @rchaves call: every action and endpoint must have correct origin attribution.
  # The origin is set at the entrypoint (TS app) and threaded through every child
  # span: nlpgo HTTP handler → engine → block executors → gateway client → gateway
  # → provider call. Sarah's engine threads it through context.Context; this spec
  # pins down the wire format and the attribute name.

  Background:
    Given nlpgo is running and the AI Gateway is reachable
    And both services are configured with OTel exporters that capture span attributes

  # ============================================================================
  # Wire format — single header that propagates across processes
  # ============================================================================

  @integration @v1
  Scenario Outline: TS app sets X-LangWatch-Origin per call site, value is one of the canonical origins
    When the TS app calls nlpgo from "<call_site>"
    Then the request carries header "X-LangWatch-Origin: <origin>"
    And the request body does NOT redundantly carry the origin (header is the source of truth)

    Examples:
      | call_site                                                    | origin            |
      | langwatch/src/server/workflows/runWorkflow.ts                | workflow          |
      | langwatch/src/server/routes/playground.ts                    | playground        |
      | langwatch/src/server/scenarios/.../workflow-agent.adapter.ts | scenario          |
      | langwatch/src/server/scenarios/.../code-agent.adapter.ts     | scenario          |
      | langwatch/src/server/topicClustering/topicClustering.ts      | topic_clustering  |
      | langwatch/src/server/evaluations/runEvaluation.ts            | evaluation        |

  @integration @v1
  Scenario: missing X-LangWatch-Origin header defaults to "unknown" and emits a warning log
    When a /go/* request arrives with no X-LangWatch-Origin header
    Then nlpgo accepts the request (no 400)
    And the request span carries attribute "langwatch.origin" = "unknown"
    And nlpgo emits a warning log line "missing_origin_header" with method + path

  @integration @v1
  Scenario: unknown origin value is preserved verbatim — operator can investigate later
    When a /go/* request arrives with X-LangWatch-Origin = "experimental_pipeline"
    Then nlpgo does NOT reject the request
    And the request span carries attribute "langwatch.origin" = "experimental_pipeline"

  # ============================================================================
  # Origin propagation through the engine — every span inherits
  # ============================================================================

  @integration @v1
  Scenario: every per-node span emitted by the engine inherits langwatch.origin from the request
    Given a workflow with three nodes: dataset → signature → end
    And the request carries X-LangWatch-Origin = "workflow"
    When the workflow runs to completion
    Then the root span has attribute "langwatch.origin" = "workflow"
    And every per-node span has the same attribute "langwatch.origin" = "workflow"
    And the gateway span (from the signature node's gateway call) also carries "langwatch.origin" = "workflow"

  @integration @v1
  Scenario: child gateway calls inherit the origin without nlpgo having to set it manually per call site
    Given the engine runs an LLM block with origin "evaluation" in context
    When the gateway client builds the outbound request
    Then the outbound request includes "X-LangWatch-Origin: evaluation"
    And the gateway-side span attaches attribute "langwatch.origin" = "evaluation"

  @integration @v1
  Scenario: code-block subprocess receives the origin via env var
    Given the engine runs a code block with origin "scenario" in context
    When nlpgo spawns python3 runner.py
    Then the subprocess environment includes "LANGWATCH_ORIGIN=scenario"
    And any HTTP calls the user code makes (rare; sandboxed) inherit the same X-LangWatch-Origin header if they go through nlpgo's outbound helper

  # ============================================================================
  # Span hierarchy — nlpgo span must be a child of the TS-app span when present
  # ============================================================================

  @integration @v1
  Scenario: incoming W3C traceparent makes nlpgo's root span a child of the TS-app span
    When the TS app sends "traceparent: 00-<trace_id>-<parent_span>-01"
    Then nlpgo's root span has trace_id = <trace_id>
    And nlpgo's root span parent_span_id = <parent_span>
    And the response includes the same traceparent (carrying nlpgo's span id) for downstream propagation

  @integration @v1
  Scenario: nlpgo and gateway emit spans with langwatch.project_id matching the request
    Given a request for project "acme-api"
    When the workflow runs through nlpgo and gateway
    Then every span emitted by either service has attribute "langwatch.project_id" = "acme-api"
    And no span is missing this attribute

  # ============================================================================
  # Per-block span granularity
  # ============================================================================

  @integration @v1
  Scenario Outline: each block kind emits a span with a stable name + attributes
    Given a workflow that runs a "<kind>" block
    When the block executes
    Then nlpgo emits a span named "<span_name>"
    And the span has attribute "langwatch.block.kind" = "<kind>"
    And the span has attribute "langwatch.block.node_id" = the workflow node id
    And the span has attribute "langwatch.origin" inherited from the request

    Examples:
      | kind      | span_name                |
      | dataset   | nlpgo.engine.dataset     |
      | signature | nlpgo.engine.signature   |
      | code      | nlpgo.engine.code        |
      | http      | nlpgo.engine.http        |
      | end       | nlpgo.engine.end         |

  # ============================================================================
  # Attributes on the LLM gateway-call span
  # ============================================================================

  @integration @v1
  Scenario: gateway-call span carries provider + model + latency + token attributes
    Given a signature node calls openai/gpt-5-mini through the gateway
    When the response returns
    Then the gateway-call span has attribute "gen_ai.system" = "openai"
    And the span has attribute "gen_ai.request.model" = "gpt-5-mini"
    And the span has attribute "gen_ai.usage.input_tokens" set
    And the span has attribute "gen_ai.usage.output_tokens" set
    And the span duration matches the wall-clock time from the request to the gateway's response

  # ============================================================================
  # Cost attribution — origin tag flows to billing-relevant traces
  # ============================================================================

  @integration @v1
  Scenario: cost attribution lands on the trace pile keyed by origin + project
    Given a workflow runs for project "acme-api" with origin "workflow"
    When the run completes
    Then the LangWatch trace at /api/trace/<trace_id> has metrics.total_cost > 0
    And the trace has a top-level attribute "langwatch.origin" = "workflow"
    And operator can list spend by origin on the cost dashboard

  # ============================================================================
  # Gateway proxy passthrough — origin still flows
  # ============================================================================

  @integration @v1
  Scenario: /go/proxy/v1/chat/completions forwards X-LangWatch-Origin to the gateway
    Given the TS app (playground call site) sends "X-LangWatch-Origin: playground"
    When nlpgo proxies the request to the gateway
    Then the outbound gateway request carries "X-LangWatch-Origin: playground"
    And the gateway span attribute "langwatch.origin" = "playground"

  # ============================================================================
  # Topic clustering — Python-side path also tags origin
  # ============================================================================

  @integration @v1
  Scenario: topic-clustering worker on Python path tags spans with origin = topic_clustering
    Given the topic-clustering worker calls /topics/batch_clustering on uvicorn
    When the worker job runs
    Then every gateway HTTP call made by topic clustering carries "X-LangWatch-Origin: topic_clustering"
    And the resulting gateway spans have attribute "langwatch.origin" = "topic_clustering"

  # ============================================================================
  # Negative cases
  # ============================================================================

  @integration @v1
  Scenario: nlpgo never logs the inline credentials JSON (security)
    When a /go/studio/execute_sync request runs
    Then no log line at any level contains the X-LangWatch-Inline-Credentials header value
    And no log line contains any api_key, aws_secret_access_key, or vertex_credentials value

  @integration @v1
  Scenario: nlpgo never propagates customer-supplied trace headers blindly past the gateway
    Given a request includes a customer Traceparent header
    When nlpgo forwards to the gateway
    Then nlpgo strips the original Traceparent (gateway will set its own based on context)
    And nlpgo emits its own span as a child of the customer trace via the OTel context, not via the header
