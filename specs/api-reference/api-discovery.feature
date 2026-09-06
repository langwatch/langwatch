Feature: An agent can find the API description without being told where it is
  As an autonomous agent pointed at a LangWatch instance
  I want to find the machine-readable description of its API from the root
  So that I can call the API without a human pasting me a URL

  # The description already existed and was already public. It was served at
  # `/api/gateway/v1/openapi.json` — a URL that reads like it belongs to the AI
  # Gateway, when the document is in fact titled "LangWatch API" and covers all
  # 42 families. Nothing at the root pointed to it, so an agent had no way to
  # arrive at it except by being handed the string.
  #
  # So this adds no second description of the API. It adds the two locations a
  # client actually tries first, one plain-text index for the reader that
  # arrives with no schema in mind, and one narrow view — `rpc.discover` — for
  # the caller that wants the RPC operations without reading 632 KB of OpenAPI
  # to find them.
  #
  # `rpc.discover` is a PROJECTION of the document, not a registry. Nothing
  # registers with it and it holds no state, so it cannot report an operation
  # that does not exist, omit one that does, or disagree about a schema. The
  # name is borrowed from OpenRPC — which describes JSON-RPC 2.0, and this is
  # not that. What is borrowed is the name a caller already knows to try; the
  # OpenAPI document remains the complete description and every response points
  # back to it.
  #
  # Root-level paths are the trap here. Only `/api/*` and the OTLP aliases reach
  # the Hono app; everything else falls through to the SPA, which answers with
  # the HTML shell and a 200. A discovery URL that returns HTML and calls it
  # success is worse than one that 404s, because the caller believes it worked.

  Background:
    Given the generated OpenAPI document describing the LangWatch REST API

  @integration
  Scenario: The description is served at the well-known location
    When an unauthenticated caller requests /.well-known/openapi
    Then the OpenAPI document is returned as JSON

  @integration
  Scenario: The description is served under the API namespace
    When an unauthenticated caller requests /api/openapi.json
    Then the OpenAPI document is returned as JSON

  @integration
  Scenario: The canonical gateway location keeps answering
    When an unauthenticated caller requests /api/gateway/v1/openapi.json
    Then the OpenAPI document is returned as JSON

  @integration
  Scenario: Every location serves one document, not three
    When the document is fetched from each of the three locations
    Then all three responses carry the same operations

  # The document is a build artifact: it cannot change while the process runs.
  # So it is serialised to bytes once at startup rather than rebuilt per
  # request, which was costing 2.8 ms and 1.3 MB of garbage on every hit of a
  # surface agents poll. The bytes are what goes on the wire — a string would
  # be re-encoded to UTF-8 on every response, which is most of the saving.

  @integration
  Scenario: Fetching the document twice returns the same document
    When the document is requested twice
    Then both responses carry identical content
    And each declares the exact length of what it sent

  @integration
  Scenario: A caller that already holds the document is told so
    Given a caller that has fetched the document and kept its entity tag
    When it asks again, offering that tag
    Then it is answered "not modified" with no body

  @integration
  Scenario: Every location offers the same entity tag for the same document
    When the document is served from any of its locations
    Then they all offer the same entity tag

  @integration
  Scenario: A caller holding a stale tag gets the document
    Given a caller offering an entity tag that is not the current one
    When it requests the document
    Then it receives the document rather than "not modified"

  # No credential, on purpose and for the same reason the gateway location has
  # none: a caller reads the description to learn how to authenticate, so
  # requiring authentication to read it would be circular.

  @integration
  Scenario: Discovery needs no credential
    Given a caller holding no API key
    When it requests any discovery location
    Then it receives the document rather than a 401

  @integration
  Scenario: A discovery location answers only GET
    When a caller POSTs to a discovery location
    Then the request is refused

  # llms.txt is for the reader that arrives with no schema in mind. It is short
  # on purpose: the OpenAPI document is 632 KB minified, and an agent that
  # fetches it to answer "what is this service" has spent most of a context
  # window to read one sentence.

  @integration
  Scenario: The plain-text index names the service and points at the schema
    When an unauthenticated caller requests /llms.txt
    Then it receives plain text naming LangWatch
    And the text links to the OpenAPI document
    And the text links to the RPC catalogue

  # The middleware accepts three credentials and calls X-Auth-Token legacy in
  # its own comments, so leading a new reader with it would teach the header we
  # intend to retire. Authorization is what a new integration should send.

  @integration
  Scenario: The plain-text index leads with the credential we want new callers to send
    When /llms.txt describes authentication
    Then it shows an Authorization bearer token first
    And it names X-Auth-Token as legacy rather than as the way in

  @integration
  Scenario: The plain-text index stays small enough to read speculatively
    When /llms.txt is served
    Then it is orders of magnitude smaller than the OpenAPI document

  # The RPC catalogue. Every claim below follows from it being derived rather
  # than declared, which is why they are worth pinning: the day someone
  # "optimises" it into a registry, these stop holding.

  @unit
  Scenario: The catalogue reports the RPC operations the document publishes
    Given a document carrying a dotted RPC operation
    When a caller POSTs to /api/rpc.discover
    Then the operation is listed with its dotted name and the path to POST to
    And its argument schema and result schema come from that same document

  @unit @integration
  Scenario: The catalogue reports no operation the document does not carry
    Given a document carrying no dotted operations
    When a caller POSTs to /api/rpc.discover
    Then the catalogue is empty
    And it still points at the OpenAPI document for the full surface

  @unit
  Scenario: A non-RPC path is not reported as an RPC
    Given a document carrying ordinary REST paths
    When the catalogue is built
    Then none of them are listed

  @unit
  Scenario: A dotted path that is not a POST is not reported as an RPC
    Given a dotted path documented under a method other than POST
    When the catalogue is built
    Then it is not listed, because the call it would advertise does not work

  @unit
  Scenario: The catalogue recognises names by the same grammar that registers them
    Given a documented path whose name v.rpc would refuse to register
    When the catalogue decides whether that path is an RPC
    Then it is not listed, because the catalogue asks the same grammar rather
      than a second one of its own

  @integration
  Scenario: Discovering the catalogue is itself an RPC
    When a caller looks at how the catalogue is served
    Then it is a POST at a dotted name, like the operations it describes

  # The routing rule these all depend on, stated as its own scenario because it
  # is the one that silently regresses: a change to the server's dispatch that
  # forgets a root-level discovery path does not fail any handler test — the
  # handler is fine, it just stops being reachable.

  @integration
  Scenario: Root-level discovery paths reach the API, not the SPA fallback
    Given a request for a root-level discovery path
    When the server routes it
    Then it is dispatched to the API rather than the single-page-app fallback
    And the response is not the HTML shell

  # A trailing slash is the same resource to any client that would send one, and
  # disagreeing about it does not cost a 404 — it costs the SPA answering with
  # the HTML shell and a 200 the caller reads as the document. So the routing
  # rule and the route table have to agree about it, in both directions.

  @integration
  Scenario: A trailing slash still reaches the API
    Given a request for a root-level discovery path with a trailing slash
    When the server routes it
    Then it is dispatched to the API
    And the API answers it with the same document as the bare path

  @integration
  Scenario: A path that merely starts with a discovery path is left to the app
    Given a request for a path extending a discovery path with more segments
    When the server routes it
    Then it is left to the single-page-app
