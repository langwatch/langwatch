Feature: OTLP body compression is recognised from the bytes, not only the header

  An exporter's zstd body is accepted whatever the header says, and so is a gzip
  body under a wrong or unlisted header (such as `snappy`). The body's own
  first bytes decide; `Content-Encoding: zstd` is also supported outright. A
  small body that expands past the byte limit is refused with a 413 under every
  encoding.

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
  Scenario: A plain body with no compression is read as before
    When an exporter sends a plain protobuf trace export with no Content-Encoding
    Then the spans in the export are read

  @unit @regression
  Scenario: A body that expands past the limit is refused under every encoding
    When a small compressed body expands past the byte limit
    Then the failure is reported as a body that is too large
    And the response status is 413
