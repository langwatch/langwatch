Feature: The design system workshop is a complete, organised showcase
  As someone building a LangWatch screen
  I want every published component in the workshop, filed where I would look, with its guidance and adoption
  So that I reuse what exists and build it the shared way

  @unit
  Scenario: Every published entry point that renders has a story
    Given the entry points the design system's package.json publishes
    When an entry point renders something
    Then a story documents it, beside its source or as its directory's story
    And an entry point exempted from a story is still published and says why

  @unit
  Scenario: Every story is filed under a section a developer reaches for
    Given the sidebar sections the workshop orders
    When the title of every story is read
    Then each title starts with one of those sections

  @unit
  Scenario: Every component page says when to use it
    Given every story filed under a component section
    When its meta is read
    Then it declares when to use the component in its usage parameter

  @unit
  Scenario: Adoption numbers are counted from the import sites
    Given the source tree that imports the design system
    When the workshop's adoption collector runs
    Then each entry point carries how many files import it and which story documents it
    And the debt the Consistency pages count is reported per file
