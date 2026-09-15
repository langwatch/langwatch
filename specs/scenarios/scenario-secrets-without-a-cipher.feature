Feature: A deployment with no encryption key still serves everything but scenario secrets

  A scenario can carry a stored secret — a credential the agent under test uses
  — and it is written to the database encrypted under the deployment's own key.
  A deployment that configured no key cannot write or read one.

  # It used to cost far more than that. The scenario store, the suites, both
  # Langy surfaces and the operator back office were composed as one graph, and
  # the composition refused outright when the key was unset — because ONE store
  # in that graph took a cipher. So an operator who had not set
  # `storedSecretEncryptionKey` lost six whole namespaces at once, with nothing
  # on the wire to say which of them was the reason.
  #
  # Nothing but a scenario's own secret reads that cipher, so nothing but a
  # scenario's own secret loses anything now. The refusal moved from the
  # composition to the cipher itself, and it is named.
  #
  # It refuses rather than answering a blank. A blank credential reaches the
  # provider, fails there, and the person reading that failure has no route
  # back to a deployment key nobody set.

  Background:
    Given a deployment that configured no stored-secret encryption key

  @integration
  Scenario: The scenario surfaces still answer
    When a member lists a project's scenarios
    Then the scenarios answer

  @integration
  Scenario: The surfaces that never read the cipher are untouched
    When a member lists a project's suites
    Then the suites answer
    And the Langy conversation and operator surfaces answer

  @integration
  Scenario: Writing a scenario secret refuses by name
    When a member saves a scenario carrying a stored secret
    Then the write is refused as a capability this deployment does not have
    And the refusal says an encryption key is what is missing

  @integration
  Scenario: The absence is named once at boot rather than once per request
    When the process composes its scenario surfaces
    Then the boot report names the absent cipher and what it costs
