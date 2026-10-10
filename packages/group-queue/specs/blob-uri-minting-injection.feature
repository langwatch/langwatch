Feature: GroupQueue durable blob tier mints uris through an injected function
  As the LangWatch event-sourcing queue offloading oversized payloads
  I want the destination type and the uri mint to come from the composition
  So that the queue framework knows no storage module and still stores a blob
  under the uri the composition's mint returns

  @unit
  Scenario: An oversized blob is stored under the uri the injected mint returns
    Given a tiered blob store with a resolved destination and an injected mint
    When a payload over the durable-tier threshold is put
    Then the object store receives the bytes under exactly the minted uri
    And the mint was handed the destination, the tenant id and the blob key

  @unit
  Scenario: The mint is handed the tenant namespace and the content-addressed key
    Given a tiered blob store with an injected mint
    When the same bytes are put twice for one tenant
    Then the mint receives the same key both times

  @unit
  Scenario: A queue configured without a uri minter refuses to offload
    Given a group queue lifecycle with a destination resolver and no uri minter
    When an oversized payload is encoded
    Then the encode fails naming the missing storage uri minter
