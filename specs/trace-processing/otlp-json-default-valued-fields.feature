Feature: OTLP/JSON spans omitting default-valued fields are accepted
  As a user exporting traces over OTLP/JSON (http/json)
  I want spans whose links and events omit zero counts and empty attribute lists to be ingested
  So that spec-compliant ProtoJSON senders, such as the OpenTelemetry Collector, do not silently lose spans

  ProtoJSON leaves out fields that hold their default value, so a zero
  droppedAttributesCount and an empty attributes list are simply absent.

  @unit
  Scenario: A link that omits droppedAttributesCount and attributes is accepted
    Given an OTLP/JSON span with a link carrying only traceId and spanId
    When the span is validated for ingest
    Then it is accepted
    And the link has empty attributes and a dropped attributes count of 0

  @unit
  Scenario: An event that omits attributes and droppedAttributesCount is accepted
    Given an OTLP/JSON span with an event carrying only timeUnixNano and name
    When the span is validated for ingest
    Then it is accepted
    And the event has empty attributes

  @unit
  Scenario: A span that omits attributes is accepted
    Given an OTLP/JSON span with no attributes field
    When the span is validated for ingest
    Then it is accepted with empty attributes

  @unit
  Scenario: A resource that omits attributes is accepted
    Given an OTLP/JSON resource with no attributes field
    When the resource is validated for ingest
    Then it is accepted with empty attributes

  @unit
  Scenario: An empty array or key-value-list attribute value is accepted
    Given an attribute whose arrayValue or kvlistValue is an empty object
    When the span is validated for ingest
    Then it is accepted
    And the array or key-value list has empty values

  @unit
  Scenario: A span that omits kind is accepted as unspecified
    Given an OTLP/JSON span with no kind field
    When the span is validated for ingest
    Then it is accepted with kind SPAN_KIND_UNSPECIFIED

  @unit
  Scenario: An OTLP/JSON request omitting default-valued fields ingests every span
    Given an OTLP/JSON request whose span has no attributes or kind
    And its link carries only traceId and spanId
    And its event carries only timeUnixNano and name
    And its resource is empty
    When the request is ingested
    Then no span is rejected
    And the span is recorded

  @unit
  Scenario: A resourceSpans entry that omits scopeSpans is accepted
    Given an OTLP/JSON request whose resourceSpans entry has no scopeSpans field
    When the request is validated for ingest
    Then it is accepted with empty scopeSpans

  @unit
  Scenario: A span sent as OTLP/JSON with omitted defaults is stored the same as its protobuf form
    Given the same span sent once as OTLP/JSON with default-valued fields omitted
    And once as protobuf
    When both requests are ingested
    Then no span is rejected
    And both record identical span data
