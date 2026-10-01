Feature: Prompt memory installation
  Prompt's process installer selects an in-memory repository bundle for tests and other
  deployments that do not open external storage.

  @integration
  Scenario: Prompt boots a working memory app in every process role
    Given the process supplies Prompt's memory stores
    When the API or worker role boots Prompt
    Then the installed Prompt app can seed and list tags

  @integration
  Scenario: Prompt memory repository bundles stay isolated per installation
    Given two API runtimes boot Prompt with memory stores
    When the first runtime creates a tag
    Then the second runtime has no copy of that tag
