Feature: Actionable documentation and restrained reading surfaces
  @e2e
  Scenario: Open search only on explicit activation
    Given focus reaches the Search button
    Then the search dialog remains closed
    When I activate Search with the keyboard shortcut
    Then search opens and returns focus on dismissal
  @e2e
  Scenario: Discover page exports and crawlable documentation
    Given a generated documentation page
    Then its md, claude and agent exports contain the same page source
    And robots, humans, agents and sitemap metadata are available
  @e2e
  Scenario: Copy a supported coding-agent command on any page
    Given any documentation page
    When I select a supported coding agent in the setup control
    Then copying gives the selected agent's real CLI command
  @unit
  Scenario: Copy a request example
    Given request data contains apostrophes and shell metacharacters
    When I copy the curl example
    Then the shell passes the data literally as request arguments
  @e2e
  Scenario: Copy a page with the keyboard
    Given clipboard access and a documentation page
    When I press Alt Shift C outside an editable control
    Then the page Markdown is copied
  @e2e
  Scenario: Reveal an overflowing tab without moving the document
    Given a compact screen with many setup tabs
    When I use End to select the final tab
    Then that tab is visible in the tab strip
    And the document does not scroll vertically
  @e2e
  Scenario: Choose and remember a code language from code tabs
    Given a guide contains equivalent Python and TypeScript examples
    When I pick TypeScript in a code switcher
    Then matching examples show their TypeScript filename and source
    And copying copies the selected source
    And the preference survives reloads and navigation
    And examples without that language keep a supported variant
  @e2e
  Scenario: Switch code languages when preference storage is unavailable
    Given preference storage is denied
    When I pick a language in a code switcher on a compact screen
    Then matching examples change on the current page
    And the page fits without horizontal document scrolling
  @e2e
  Scenario: Read code filenames and source without JavaScript
    Given JavaScript is disabled
    Then code examples have an icon and filename
    And the default example source remains readable
    And clipboard controls remain disabled
  @e2e
  Scenario: Show the matching theme image and readable reference details
    Given documentation has paired light and dark images
    Then only the current theme's image is visible inside a frame
    And deployment responsibilities have explicit yes and no values
    And prose-heavy connection references use labelled details
    And external support navigation has a visible external indicator
    And linked cards have complete rounded borders and clear action indicators
    And screenshots include matching light and dark variants
  @e2e
  Scenario: Follow nested headings with an indented contents path
    Given the contents rail includes subsections
    Then its guide follows the subsection indentation
    When I navigate to a subsection
    Then the active path follows that subsection
    And reduced motion disables the path animation
  @e2e
  Scenario: Choose an agent and copy the complete setup prompt
    Given the sidebar command and setup prompt card are visible
    Then the command has a visible agent picker
    And the agent names sit on a wheel, fading with distance, that spins to the next agent until I choose one, unless motion is reduced
    And choosing an agent spins the wheel to it
    And the setup card has one copy action beside its prompt title
    When I select an agent and navigate to another page
    Then the sidebar keeps that choice and copies its command
    And all setup agents can copy the complete authored prompt
    And the complete prompt remains readable without JavaScript
    And both controls fit compact screens in light and dark themes
  @unit
  Scenario: Highlight JSON examples without interpreting their content as markup
    Given a response example includes keys, strings, numbers and booleans
    Then the example assigns distinct syntax token classes
    And HTML-like response content is escaped
  @e2e
  Scenario: Browse compact API schemas and skill actions
    Given a documentation API reference and skill directory
    Then error response schemas can be expanded individually without JavaScript
    And JSON response examples have visible syntax tokens
    And request parameters fit a compact two-column layout where space permits
    And full skill prompts can be viewed and copied
    And sidebar selection moves between pages with reduced motion respected
    And language choices appear alongside code examples
  @unit
  Scenario: Read skill prompts as Markdown while preserving the copied source
    Given a skill prompt includes headings, emphasis, code and HTML-like text
    Then it renders as Markdown rather than one plain-text fence
    And its prompt text remains unchanged for copying
    And prompt prose cannot execute MDX or raw HTML
  @e2e
  Scenario: Read rendered skill prompts and use setup buttons with flat tabs
    Given the skill directory and coding-agent overview
    Then expanded skill prompts have headings, inline code and highlighted code fences
    And copying preserves the full authored Markdown
    And setup actions have labelled buttons with icons and working destinations
    And tab strips have no top gap or rounded top corners
    And both light and dark captures show the rendered prompt and actions
