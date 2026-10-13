Feature: Resource catalogue pattern
  As someone building a page that lists a modest set of resources
  I want one runnable example of tiles, filters, a detail drawer and item menus
  So that I copy a catalogue that already works, in light and dark

  @integration
  Scenario: Every catalogue story shows its state in light and dark
    Given the named stories of the Resource catalogue pattern
    When each is rendered in the light and in the dark colour mode
    Then it shows its own heading, tiles, notice or drawer

  @integration
  Scenario: Filtering by type shows only that type
    Given the catalogue of six agents
    When the reader chooses the HTTP chip
    Then only the HTTP agents show and the count reads two of six

  @integration
  Scenario: A search with no matches can be cleared
    Given a search that matches no agent
    Then the page says so and offers a docs page and a prompt for a coding agent
    When the reader clears the filters
    Then every agent shows again

  @integration
  Scenario: A tile opens once from the keyboard and focus returns to it
    Given the catalogue of six agents
    When the reader focuses a tile and presses Enter
    Then one drawer opens with the agent's facts
    When the reader presses Escape
    Then the drawer closes and focus is back on the same tile

  @integration
  Scenario: A tile menu does not open the detail
    Given the catalogue of six agents
    When the reader opens the actions menu of a tile
    Then the menu offers Edit and View history and no drawer opens
    When the reader chooses View history
    Then a notice says what the application would open and no drawer opens

  @integration
  Scenario: Edit agent in the detail asks for the editor and closes the drawer
    Given the detail of an agent
    When the reader chooses Edit agent
    Then the drawer closes and the editor is requested for that agent

  @integration
  Scenario: A failed load can be retried and leads to the docs
    Given the agents failed to load
    Then the page offers Try again and a link to the troubleshooting page
    When the reader chooses Try again
    Then the agents show

  @integration
  Scenario: An empty catalogue says where to start
    Given no agents
    Then the page offers a docs page and a prompt for a coding agent

  @integration
  Scenario: A long name stays reachable at the tile and in full in the detail
    Given an agent with a very long name
    Then its tile opener carries the full name
    And the detail drawer shows the whole name

  @unit
  Scenario: The example uses only public design system entry points
    Given the source of the example
    Then it imports no Chakra or Emotion and no design system file by relative path
