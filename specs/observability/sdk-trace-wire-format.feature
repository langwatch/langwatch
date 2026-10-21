Feature: SDKs send traces as gzipped OTLP/protobuf by default
  Every LangWatch SDK exports spans to the OTLP/HTTP traces route as protobuf,
  gzipped, without the developer configuring either. Protobuf is the smaller
  and cheaper body for the receiver to parse, and gzip shrinks it further on
  the wire. A developer can still turn compression off.

  @unit
  Scenario: The Python SDK sends gzipped protobuf by default
    Given no OTEL_EXPORTER_OTLP compression variable is set
    When the Python SDK builds its trace exporter
    Then the exporter sends protobuf bodies compressed with gzip

  @unit
  Scenario: The Python SDK leaves compression to the OTel variables when they are set
    Given OTEL_EXPORTER_OTLP_TRACES_COMPRESSION is set to "none"
    When the Python SDK builds its trace exporter
    Then the exporter takes its compression from the environment

  @unit
  Scenario: The TypeScript SDK sends gzipped protobuf by default
    Given no OTEL_EXPORTER_OTLP compression variable is set
    When the TypeScript SDK builds its trace exporter
    Then the exporter sends protobuf bodies compressed with gzip

  @unit
  Scenario: The Go SDK sends gzipped protobuf by default
    Given no OTEL_EXPORTER_OTLP compression variable is set
    When the Go SDK exports a batch of spans with its default exporter
    Then the request has Content-Type "application/x-protobuf" and Content-Encoding "gzip"
    And the body decodes as an OTLP ExportTraceServiceRequest

  @unit
  Scenario: The Go SDK leaves compression to the OTel variables when they are set
    Given OTEL_EXPORTER_OTLP_TRACES_COMPRESSION is set to "none"
    When the Go SDK exports a batch of spans with its default exporter
    Then the request carries an uncompressed protobuf body
