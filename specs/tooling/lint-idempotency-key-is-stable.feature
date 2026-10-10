Feature: The idempotency-key-is-stable lint rule
  An idempotency key exists so that a retry of the same logical operation is
  recognised as the same operation. A key minted where the request is built
  gives every attempt a different key, so the field is on the wire and the
  guarantee is absent. Replacing the random with a house ksuid changes
  nothing, which is why id-generation-origin no longer governs these values.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A key minted at the call site is reported
    Given a production source assigning idempotencyKey a fresh random, a timestamp or a template built from one
    When the idempotency-key-is-stable rule runs over it
    Then it reports mintedAtCallSite naming the property and the mint
    And the fix says to derive the key from the request or bind it once for the operation

  @unit
  Scenario: A snake-case key or an Idempotency-Key header minted at the call site is reported
    Given a production source minting `idempotency_key`, an `Idempotency-Key` header property and a `headers.set("idempotency-key", …)` call
    When the idempotency-key-is-stable rule runs over it
    Then it reports mintedAtCallSite for each, naming the key as spelled, on its line

  @unit
  Scenario: A key read from a binding is left alone
    Given a production source assigning idempotencyKey an identifier or a member expression
    When the idempotency-key-is-stable rule runs over it
    Then it reports nothing, because whether that binding is stable is not decidable here

  @unit
  Scenario: A key bound once for the operation is left alone
    Given a production source whose key comes from a bind-once hook, a ref slot or a module-level constant
    When the idempotency-key-is-stable rule runs over it
    Then it reports nothing

  @unit
  Scenario: A caller-supplied key with a fallback is left alone
    Given a production source using the caller's own key and minting one only when none was sent
    When the idempotency-key-is-stable rule runs over it
    Then it reports nothing, because the unkeyed path is the caller's decision and not the code's

  @unit
  Scenario: A key derived from the request is left alone
    Given a production source deriving idempotencyKey from a hash of the request's own arguments
    When the idempotency-key-is-stable rule runs over it
    Then it reports nothing
