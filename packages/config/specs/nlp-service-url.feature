Feature: The NLP engine's address is one shared leaf
  As the team composing a process from the framework and many modules
  I want LANGWATCH_NLP_SERVICE declared once, as the nlpServiceUrl leaf in @langwatch/config
  So that the process and every module that calls the engine read it without a collision

  # ARCHITECTURE.md §6, layer 3: the parse admits a re-bound env var only when
  # the claimants are literally the same leaf.

  @unit
  Scenario: The process and a module both holding the engine address leaf parse it
    Given the process owner and a module both hold the exported nlpServiceUrl leaf
    When the process parses its config with LANGWATCH_NLP_SERVICE set
    Then each owner's slice carries the same trimmed engine address

  @unit
  Scenario: A blank engine address reads as absent
    Given an owner holds the exported nlpServiceUrl leaf
    When the process parses its config with LANGWATCH_NLP_SERVICE blank or unset
    Then the owner's slice carries no engine address
