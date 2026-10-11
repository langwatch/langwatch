Feature: Actionable documentation and restrained reading surfaces
  Scenario: Open search only on explicit activation
    Given focus reaches the Search button
    Then the search dialog remains closed
    When I activate Search with the keyboard shortcut
    Then search opens and returns focus on dismissal
  Scenario: Discover page exports and crawlable documentation
    Given a generated documentation page
    Then its md, claude and agent exports contain the same page source
    And robots, humans, agents and sitemap metadata are available
  Scenario: Copy a supported coding-agent command on any page
    Given any documentation page
    When I select a supported coding agent in the setup control
    Then copying gives the selected agent's real CLI command
  Scenario: Copy a request example
    Given request data contains apostrophes and shell metacharacters
    When I copy the curl example
    Then the shell passes the data literally as request arguments
  Scenario: Copy a page with the keyboard
    Given clipboard access and a documentation page
    When I press Alt Shift C outside an editable control
    Then the page Markdown is copied
  Scenario: Reveal an overflowing tab without moving the document
    Given a compact screen with many setup tabs
    When I use End to select the final tab
    Then that tab is visible in the tab strip
    And the document does not scroll vertically
