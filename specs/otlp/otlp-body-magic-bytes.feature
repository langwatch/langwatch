Feature: OTLP body compression is recognised from the bytes, not only the header

  Some OTLP exporters compress with zstd and send no Content-Encoding header,
  or gzip a body under the wrong header (or one we do not list, such as
  `snappy`). The receiver used to believe the header alone, so those bodies
  were treated as plain protobuf and rejected as unparseable, and the
  exporter's data was lost.

  The body's own first bytes now decide: gzip and zstd announce themselves, and
  that wins over whatever the header says. `Content-Encoding: zstd` is also
  supported outright. The size bound is unchanged and applies to every
  decompressor, so a small body that expands past the limit is still refused
  with a 413.

  Background:
    Given the shared OTLP body reader used by the traces, logs and metrics routes

  @unit @regression
  Scenario: A zstd body sent without a Content-Encoding header is accepted
    When an exporter sends a zstd-compressed trace export with no Content-Encoding
    Then the spans in the export are read

  @unit @regression
  Scenario: A zstd body sent as identity is accepted
    When an exporter sends a zstd-compressed trace export declared as identity
    Then the spans in the export are read

  @unit
  Scenario: A zstd body declared as zstd is accepted
    When an exporter sends a zstd-compressed trace export declared as zstd
    Then the spans in the export are read

  @unit @regression
  Scenario: A gzip body under a wrong or unsupported encoding is accepted
    When an exporter sends a gzip-compressed trace export declared as deflate, br or snappy
    Then the spans in the export are read

  @unit
  Scenario: A body with no compression signature is handled as before
    When an exporter sends a plain protobuf trace export with no Content-Encoding
    Then the spans in the export are read
    And a plain body under an unsupported encoding is refused as a client error

  @unit @regression
  Scenario: A body that expands past the limit is refused under every decoder
    When a small compressed body expands past the byte limit
    Then the failure is reported as a body that is too large
    And the response status is 413
