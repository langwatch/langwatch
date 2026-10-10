Feature: The NLP engine's code-block timeout is one shared leaf
  As the team composing a process from the framework and many modules
  I want NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS declared once, as the nlpCodeBlockTimeoutSeconds leaf in @langwatch/config
  So that the process, workflow and scenario read it without a collision

  # ARCHITECTURE.md §6, layer 3: the parse admits a re-bound env var only when
  # the claimants are literally the same leaf.

  @unit
  Scenario: The process and a module both holding the code-block timeout leaf parse it
    Given the process owner and a module both hold the exported nlpCodeBlockTimeoutSeconds leaf
    When the process parses its config with NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS set
    Then each owner's slice carries the same raw value, unclamped
