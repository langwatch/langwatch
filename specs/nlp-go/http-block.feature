Feature: HTTP block — call an external endpoint with templated body and JSONPath response extraction
  The HTTP block lets a workflow author call any external service. The request
  body is a Liquid template (variable interpolation from upstream nodes), the
  response body is parsed as JSON and a single field is extracted with a
  JSONPath expression. Auth, timeout, and SSRF protection match the Python
  implementation byte-for-byte.

  See _shared/contract.md §5; Python parity: langwatch_nlp/langwatch_nlp/studio/execute/http_node.py

  Background:
    Given nlpgo is listening on :5562

  Rule: Method, URL, and content-type round-trip to upstream

    @integration
    Scenario Outline: each HTTP method is forwarded with the configured headers and body
      Given an HTTP node configured with method=<method>, url=http://upstream/echo, headers={"X-Test":"yes"}
      And the body template "{\"q\":\"{{ input.question }}\"}" and content_type "application/json"
      And the upstream echoes the request as JSON
      When the engine invokes the node with {"question": "ping"}
      Then the upstream observed method <method>
      And the upstream observed body {"q":"ping"}
      And the upstream observed header "X-Test: yes"

      Examples:
        | method |
        | GET    |
        | POST   |
        | PUT    |
        | DELETE |
        | PATCH  |

  Rule: Body template renders Liquid expressions from upstream node outputs

    @unit
    Scenario: a template references {{ upstream.field }} and renders the value
      Given an HTTP node with body template "Hello {{ upstream.name }}" and content_type "text/plain"
      And the upstream node output {"name": "World"}
      When the engine renders the body
      Then the rendered body equals "Hello World"

    @unit
    Scenario: missing template variable renders as an empty string with a warning
      Given an HTTP node with body template "{{ upstream.missing }}"
      And the upstream node output {}
      When the engine renders the body
      Then the rendered body equals ""
      And a warning log includes "template variable not found: upstream.missing"

    @unit
    Scenario: arrays interpolate as JSON arrays inside JSON content_type bodies
      Given an HTTP node with body template "{\"ids\": {{ upstream.ids }}}" and content_type "application/json"
      And the upstream node output {"ids": [1,2,3]}
      When the engine renders the body
      Then the rendered body equals "{\"ids\": [1,2,3]}"

  Rule: JSONPath extracts the configured field from the response

    @integration
    Scenario: output_path "$.data.first.name" extracts a nested field
      Given an HTTP node with output_path "$.data.first.name"
      And the upstream returns {"data": {"first": {"name": "Alice"}}}
      When the engine invokes the node
      Then the node's output equals {"value": "Alice"}

    @integration
    Scenario: an output_path that matches nothing returns a node-level error
      Given an HTTP node with output_path "$.missing"
      And the upstream returns {"present": "value"}
      When the engine invokes the node
      Then the node's status is "error"
      And the error.message contains "jsonpath_no_match"

    @integration
    Scenario: an output_path matching multiple values returns the array
      Given an HTTP node with output_path "$.items[*].id"
      And the upstream returns {"items": [{"id":1},{"id":2},{"id":3}]}
      When the engine invokes the node
      Then the node's output equals {"value": [1, 2, 3]}

  Rule: Auth schemes are applied to the outbound request

    @integration
    Scenario: bearer auth attaches Authorization: Bearer <token>
      Given an HTTP node with auth {"type": "bearer", "token": "tok-abc"}
      When the engine invokes the node
      Then the upstream observed header "Authorization: Bearer tok-abc"

    @integration
    Scenario: api_key auth attaches the configured header
      Given an HTTP node with auth {"type": "api_key", "header": "X-API-Key", "key": "secret-123"}
      When the engine invokes the node
      Then the upstream observed header "X-API-Key: secret-123"

    @integration
    Scenario: basic auth attaches Authorization: Basic <base64>
      Given an HTTP node with auth {"type": "basic", "username": "u", "password": "p"}
      When the engine invokes the node
      Then the upstream observed header matching `^Authorization: Basic dTpw$`

    @integration
    Scenario: secret references resolve at request time, not at parse time
      Given an HTTP node with auth {"type": "bearer", "token": "{{ secrets.UPSTREAM_TOKEN }}"}
      And the project has secret UPSTREAM_TOKEN="rotated-value"
      When the engine invokes the node
      Then the upstream observed header "Authorization: Bearer rotated-value"
      And the rendered body in execution events does NOT contain "rotated-value"

  Rule: Timeout aborts the request and reports an error

    @integration
    Scenario: a request exceeding timeout_ms returns a node error within the budget
      Given an HTTP node with timeout_ms=500
      And an upstream that delays 5 seconds before responding
      When the engine invokes the node
      Then within 700ms the node's status is "error"
      And the error.message contains "timeout"

  Rule: SSRF protection is governed by BLOCK_LOCAL_HTTP_CALLS (cloud metadata always blocked)
    See specs/security/ssrf-blocking.feature for the cross-service contract.

    @unit
    Scenario Outline: blocked destinations return ssrf_blocked when BLOCK_LOCAL_HTTP_CALLS is "true"
      Given BLOCK_LOCAL_HTTP_CALLS is "true"
      And an HTTP node with url=<url>
      And ALLOWED_PROXY_HOSTS is empty
      When the engine invokes the node
      Then no outbound connection is attempted
      And the node's status is "error"
      And the error.message contains "ssrf_blocked"

      Examples:
        | url                                              |
        | http://127.0.0.1/                                |
        | http://localhost/                                |
        | http://0.0.0.0/                                  |
        | http://169.254.169.254/latest/meta-data/         |
        | http://10.0.0.1/                                 |
        | http://192.168.1.1/                              |
        | http://[::1]/                                    |

    @unit
    Scenario: BLOCK_LOCAL_HTTP_CALLS unset allows local destinations (default permissive)
      Given BLOCK_LOCAL_HTTP_CALLS is unset
      And an HTTP node with url=http://127.0.0.1:9001/echo
      When the engine invokes the node
      Then the outbound connection is attempted

    @unit
    Scenario: cloud metadata is blocked even when BLOCK_LOCAL_HTTP_CALLS is "false"
      Given BLOCK_LOCAL_HTTP_CALLS is "false"
      And an HTTP node with url=http://169.254.169.254/latest/meta-data/
      When the engine invokes the node
      Then the node's status is "error"
      And the error.message contains "ssrf_blocked"

    @unit
    Scenario: ALLOWED_PROXY_HOSTS allowlist permits explicitly-allowed hosts
      Given BLOCK_LOCAL_HTTP_CALLS is "true"
      And ALLOWED_PROXY_HOSTS contains "127.0.0.1,internal-mock.test"
      And an HTTP node with url=http://127.0.0.1:9001/echo
      When the engine invokes the node
      Then the outbound connection is attempted
      And the node's status reflects the upstream response

  Rule: Non-2xx responses fail the node by default

    @integration
    Scenario Outline: status >= 400 fails the node and the body is captured for diagnostics
      Given an HTTP node calling an upstream that returns <status>
      When the engine invokes the node
      Then the node's status is "error"
      And the error.payload.upstream_status equals <status>
      And the error.payload.upstream_body is captured (truncated to 4 KiB)

      Examples:
        | status |
        | 400    |
        | 401    |
        | 404    |
        | 500    |
        | 502    |
        | 504    |

  Rule: Parity with Python http_node executor

    @integration @parity
    Scenario: same template + auth + JSONPath produce identical observed-by-upstream requests on Go and Python
      Given a fixture HTTP workflow at tests/fixtures/workflows/http_only.json
      And a recording mock upstream
      When I POST the same input to /go/studio/execute_sync (Go) and /studio/execute_sync (Python)
      Then the upstream recordings are byte-equivalent for method, path, headers (excluding User-Agent), and body
      And both responses' result.outputs are byte-equivalent
