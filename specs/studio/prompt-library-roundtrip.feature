Feature: A workflow LLM node round-trips its prompt with the prompt library

  An LLM node on the optimization-studio canvas edits its prompt in a drawer.
  The node can either keep the prompt inline (unpublished local edits) or save
  it to the shared prompt library, after which the node references the saved
  prompt by id. When the node references a saved prompt, reopening it must show
  the saved prompt loaded from the library, not a stale copy of the inline
  config the node held before it was saved. Otherwise a prompt saved from the
  workflow looks deleted when the node is reopened, even though it is present in
  the library and the playground.

  Background:
    Given an LLM node selected on the studio canvas with its prompt drawer open

  @integration
  Scenario: A saved prompt opens from the library when its node is reopened
    Given the node references a prompt saved in the library
    And the node has no unpublished local edits
    When the prompt drawer is opened for the node
    Then it shows the prompt loaded from the library
    And it does not override it with the node's stale inline config

  @integration
  Scenario: Unpublished local edits are restored when the node is reopened
    Given the node has unpublished local edits to its prompt
    When the prompt drawer is opened for the node
    Then it restores the unpublished edits on top of the saved prompt

  @integration
  Scenario: A node whose library prompt is missing shows its inline config
    Given the node references a prompt that is not found in the project
    When the prompt drawer is opened for the node
    Then it falls back to the node's inline config instead of an empty form
