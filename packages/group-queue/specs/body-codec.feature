# See ../adrs/026-canonical-payload-envelope.md
Feature: Group Queue body codec

  A body up to 64 KiB is compressed on the event loop, where a pooled async
  stream costs more than the work; larger bodies are compressed and
  decompressed off it. The choice never changes the bytes a body decodes to.

  @unit
  Scenario: A body round-trips whichever side of the in-line codec size it falls
    Given a body small enough to compress in-line, or large enough to compress off the event loop
    When it is compressed with gzip or zstd and decompressed again
    Then the bytes are the ones it started with
    And a multibyte text body is sized by its bytes, not its characters
