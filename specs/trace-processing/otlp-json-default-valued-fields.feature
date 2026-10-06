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
  Scenario: A span and resource that omit attributes are accepted
    Given an OTLP/JSON span and resource with no attributes field
    When they are validated for ingest
    Then both are accepted with empty attributes
