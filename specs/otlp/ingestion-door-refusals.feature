Feature: OTLP ingestion doors refuse what they cannot safely hold

  The trace, log and metric doors, and the governance source doors, take
  exporter bodies from the open internet. Each one refuses a body it will not
  hold, and says so with a status the exporter can act on, rather than holding
  it or answering 500.

  The shared reader's own behaviour is specified elsewhere and not repeated
  here: the wire cap in body-size-limits.feature, compression sniffing and the
  decoder's expansion bound in otlp-body-magic-bytes.feature, torn and
  undecodable bodies in otlp-body-read-failures.feature. This file asks the
  same questions of each door as it is mounted.

  Only OTLP over HTTP is served, as JSON or protobuf. There is no gRPC receiver.

  Rule: A body that expands past the decompressed cap is refused on every signal door

    @integration
    Scenario: A trace export that decompresses past the cap is refused
      Given an exporter holds a key that may create traces in its project
      When it exports a small gzip body that expands past the decompressed cap to the trace door
      Then the export is refused as too large
      And nothing is recorded

    @integration
    Scenario: A log export that decompresses past the cap is refused
      Given an exporter holds a key for its project
      When it exports a small gzip body that expands past the decompressed cap to the log door
      Then the export is refused as too large
      And nothing is recorded

    @integration
    Scenario: A metric export that decompresses past the cap is refused
      Given an exporter holds a key for its project
      When it exports a small gzip body that expands past the decompressed cap to the metric door
      Then the export is refused as too large
      And nothing is recorded

  Rule: A body over the wire cap is refused before it is held

    @integration
    Scenario: The log door refuses a body over the wire cap
      Given an exporter holds a key for its project
      When it exports a body larger than the bulk wire cap to the log door
      Then the export is refused as too large
      And nothing is recorded

    @integration
    Scenario: The metric door refuses a body over the wire cap
      Given an exporter holds a key for its project
      When it exports a body larger than the bulk wire cap to the metric door
      Then the export is refused as too large
      And nothing is recorded

    # Gap: the governance routes declare no body limit, so the whole body is
    # held before the source is resolved and the decoder refuses it.
    @integration @unimplemented
    Scenario: The governance OTLP doors refuse a body over the wire cap before holding it
      Given an ingestion source with a bearer secret
      When a body larger than the bulk wire cap is posted to its trace, log or metric door
      Then the export is refused as too large before the body is read
      And nothing is recorded

  Rule: Only OTLP over HTTP is served

    # Gap: no door looks at a gRPC content type; the frame reaches the
    # protobuf parser, which may accept or fail it by chance.
    @integration @unimplemented
    Scenario: A gRPC-framed export is refused with a clear answer
      Given an exporter holds a key for its project
      When it posts a gRPC-framed request with content type application/grpc to the trace, log or metric door
      Then the export is refused as an unsupported media type
      And nothing is recorded

  Rule: The metric door serves an exporter over its composition

    @integration
    Scenario: An exported metric batch reaches the metric pipeline
      Given an exporter holds a key for its project
      When it exports a metric batch to the metric door
      Then the batch is accepted
      And its data point is sent on to the metric pipeline against the credential's own project
