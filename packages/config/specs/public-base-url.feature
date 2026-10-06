Feature: The deployment's public origin is one shared leaf
  As the team composing a process from the framework and many modules
  I want BASE_HOST declared once, as the publicBaseUrl leaf in @langwatch/config
  So that the process and every module that links back read it without a collision

  # ARCHITECTURE.md §6, layer 3: the parse admits a re-bound env var only when
  # the claimants are literally the same leaf.

  @unit
  Scenario: The process and a module both holding the public origin leaf parse it
    Given the process owner and a module both hold the exported publicBaseUrl leaf
    When the process parses its config with BASE_HOST set
    Then each owner's slice carries the same trimmed origin

  @unit
  Scenario: A blank public origin reads as absent
    Given an owner holds the exported publicBaseUrl leaf
    When the process parses its config with BASE_HOST blank or unset
    Then the owner's slice carries no public origin
