Feature: The NLP engine's credential is one shared handle
  As the team composing a process from the framework and many modules
  I want LANGWATCH_NLP_INTERNAL_SECRET loaded once, as the nlpInternalSecret handle in @langwatch/secrets
  So that the process and every module that calls the engine claim it without a refusal

  # ARCHITECTURE.md §6, layer 3: a double claim passes only for the very same handle.

  @unit
  Scenario: The process and a module both holding the engine credential handle boot
    Given the process owner and a module both hold the exported nlpInternalSecret handle
    When the process checks its owners' secret claims
    Then neither claim is refused
    And a module loading its own handle for LANGWATCH_NLP_INTERNAL_SECRET is still refused, naming the process
