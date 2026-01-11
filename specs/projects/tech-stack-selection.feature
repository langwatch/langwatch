@unit
Feature: Tech Stack Selection UI
  As a user creating a new project
  I want to select my language and framework using visual icon cards
  So that I can quickly configure my project's tech stack

  Background:
    Given the tech stack selection component is rendered

  Scenario: Displays all available language options
    When I view the language selection grid
    Then I see selectable cards for:
      | language   |
      | Python     |
      | TypeScript |
      | Other      |

  @visual
  Scenario: Language cards display icons
    When I view the language selection grid
    Then each language card displays its corresponding icon
    And cards are displayed in a horizontal layout

  Scenario: Default language is pre-selected
    Given no language has been explicitly selected
    When I view the language selection grid
    Then "Python" is selected by default

  Scenario: Select a language
    Given "Python" is currently selected
    When I click on the "TypeScript" card
    Then "TypeScript" becomes selected
    And "Python" is no longer selected

  Scenario: Only one language can be selected at a time
    Given "Python" is selected
    When I click on "TypeScript"
    Then only "TypeScript" is selected
    And the selection count is exactly 1

  @visual
  Scenario: Selected language card has visual indicator
    When I select "TypeScript"
    Then the "TypeScript" card shows a selected state
    And unselected cards show a deselected state with grayscale filter

  Scenario: Displays framework options based on selected language
    Given "Python" is selected
    When I view the framework selection grid
    Then I see framework cards relevant to Python:
      | framework    |
      | OpenAI       |
      | Azure OpenAI |
      | LangChain    |
      | DSPy         |
      | Other        |

  Scenario: Framework options update when language changes
    Given "Python" is selected
    And I see Python frameworks
    When I select "TypeScript"
    Then the framework grid updates to show TypeScript frameworks:
      | framework      |
      | OpenAI         |
      | Azure OpenAI   |
      | Vercel AI SDK  |
      | LangChain      |
      | Other          |

  Scenario: Default framework is selected when language changes
    Given "Python" is selected with "OpenAI" framework
    When I select "TypeScript"
    Then the first available TypeScript framework is auto-selected

  Scenario: Select a framework
    Given "Python" is selected
    And "OpenAI" framework is currently selected
    When I click on the "LangChain" card
    Then "LangChain" becomes the selected framework
    And "OpenAI" is no longer selected

  Scenario: Only one framework can be selected at a time
    Given a framework is selected
    When I click on a different framework
    Then only the new framework is selected

  @visual
  Scenario: Selected framework card has visual indicator
    When I select "LangChain" framework
    Then the "LangChain" card shows a selected state

  Scenario: Framework grid shows descriptive header
    Given "TypeScript" is selected
    When I view the framework selection grid
    Then the header shows "Library or Framework"

  @visual
  Scenario: Framework cards display icons
    When I view the framework selection grid
    Then each framework card displays its corresponding icon

  Scenario: Cards are keyboard accessible
    When I focus on the language grid
    Then I can navigate between cards using keyboard
    And I can select a card by pressing Enter or Space

  Scenario: Cards have appropriate ARIA labels
    When I inspect a language card
    Then it has an aria-label describing the language
    And it has aria-pressed indicating selection state
