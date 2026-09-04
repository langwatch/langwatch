Feature: A storage driver refuses an address belonging to another provider

  A stored object's URI is its address, and the driver reads the bucket and
  key straight out of it. The S3 driver recognised every scheme the platform
  knows and then sliced the string as if it were always `s3://` — so an
  `azure-blob://` address produced a bucket invented from the wrong prefix and
  the driver went on to ask S3 for it.

  Recognising a scheme is not accepting it. The driver that holds an address
  it cannot read refuses it by name. Nobody outside the process can act on
  that, so it is a plain named failure that degrades to unknown with a trace
  id rather than a customer-facing refusal.

  @unit
  Scenario: The S3 driver refuses an Azure address
    Given the S3 storage driver
    When it is asked to read an azure-blob address
    Then it refuses the address as an unsupported scheme
    And it names s3 as the scheme it expected
    And it never asks S3 for an object

  @unit
  Scenario: The S3 driver refuses an Azure address on every byte operation
    Given the S3 storage driver
    When an azure-blob address reaches its write, delete or metadata operations
    Then each one refuses the address as an unsupported scheme

  @unit
  Scenario: An S3 address is still read as bucket and key
    Given the S3 storage driver
    When it is asked to read an s3 address
    Then the bucket and key come from the address itself
