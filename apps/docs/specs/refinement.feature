Feature: Actionable documentation and restrained reading surfaces
  @e2e
  Scenario: Open search only on explicit activation
    Given focus reaches the Search button
    Then the search dialog remains closed
    When I activate Search with the keyboard shortcut
    Then search opens and returns focus on dismissal
  @integration
  Scenario: Open search from the first shortcut, even one pressed while the page loads
    Given the page's scripts have not finished loading
    When I press Meta+K or Ctrl+K
    Then the browser's own shortcut is suppressed
    And the shortcut is held until the search island has loaded, which then opens search
  @e2e
  Scenario: Discover page exports and crawlable documentation
    Given a generated documentation page
    Then its md, claude and agent exports contain the same page source
    And robots, humans, agents and sitemap metadata are available
    And canonical, sitemap and llms.txt addresses name https://langwatch.ai/docs, where the docs are served
    And the sitemap dates each page by its last commit when the full history is available
    And llms-full.txt holds every page's Markdown in reading order, after the agent guidance
  @unit
  Scenario: Describe every page to search engines
    Given an API page whose page and operation both lack a description
    When its head is rendered
    Then the description names the page, its method and path
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
  @unit
  Scenario: Treat the spellings of one language as one choice
    Given tab labels such as TypeScript, JavaScript, Node.js, Python SDK, py, curl and Bash
    Then TypeScript, JavaScript and Node are one language, Python and py another, curl, Bash and Shell a third
    And a filename's extension or a label naming no language offers no choice
    And a group offering fewer than two languages takes no part
  @integration
  Scenario: Choose a language once and see it in every matching tab group
    Given a page has several tab and code groups, some labelled "Python" and others "Python SDK"
    When I pick TypeScript in one of them
    Then every group offering TypeScript shows it, and groups without it keep their tab
    And the tab I picked stays where it is on screen
    And the choice is remembered for later pages and pages swapped in place
  @integration
  Scenario: Show the remembered language before the page first paints
    Given I chose TypeScript on an earlier page
    When another page with TypeScript examples is parsed
    Then its groups show TypeScript, with the matching panel and filename, before any island loads
  @unit
  Scenario: Fade a page's opening blocks in without holding them back
    When a page loads or is swapped in place
    Then its header and first content blocks rise in with a short stagger of at most 400ms
    And only opacity and transform change, starting visible enough to count as painted
    And readers who ask for reduced motion see no animation
  @unit
  Scenario: Open and close every disclosure with a short height and fade
    Given a page has accordions, expandable fields, sidebar groups and native disclosures
    When I open or close one
    Then its panel grows or shrinks with a fade in about 200ms, in both directions
    And reversing it halfway starts from where it is, without a jump
    And readers who ask for reduced motion see it open and close at once
  @integration
  Scenario: Tell prose links from text without a heavy underline
    Given a paragraph holds a link
    Then the link has a thin, low-contrast underline at rest, so it never relies on colour alone
    And hovering it changes its colour and strengthens the underline with a short transition
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
  @integration
  Scenario: Frame every authored screenshot in one window
    Given a guide shows a screenshot, bare or inside a Frame
    Then it sits in one framed window with a soft shadow and a greyscale top bar of three grey dots
    And a Frame holding an image draws only one window, with its caption below
    And an SVG diagram keeps the frame without the bar
    And external badges and card or navigation logos stay unframed
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
    And each skill is one compact block in a shared list: its title, a one-line caption, the install command that copies on click, and a neutral copy-prompt button beside it
    And the prompt opens from a quiet row whose chevron sits beside its label, with a height animation unless motion is reduced
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
  @e2e
  Scenario: Choose a page action from a compact menu
    Given the Copy page menu is open
    Then each action shows its icon on a bordered chip with a one-line description
    And the copy action shows its keyboard shortcut on devices with a fine pointer
  @e2e
  Scenario: Click, drag and spin the agent wheel
    Given the sidebar agent wheel shows the chosen agent with faded neighbours
    When I click a neighbour
    Then the wheel turns to it and it becomes the chosen agent
    When I drag the wheel up or down and let go
    Then it follows the pointer, without scrolling the page on touch, and snaps to the nearest agent
    When I flick it
    Then it keeps spinning, slows with friction, settles on a supported agent and chooses it
    And the mouse wheel or trackpad turns it, and the arrow keys still change the choice
    And with reduced motion a drag steps one agent, with no spin
    And assistive technology reads a labelled control whose value is the chosen agent, and never a casino name
  @unit
  Scenario: Spin the agent wheel with momentum and land on a real agent
    Given a released wheel and the speed of the flick
    Then friction carries it further the faster it was flicked, up to a top speed, and it rests on the nearest agent
    And each frame closes the gap to that agent by the same share, so it eases in and stops exactly on it
    And names fade with their distance from the middle, as they do at rest
  @unit
  Scenario: Flash casino names past while the agent wheel spins fast
    Given the wheel is spinning
    Then casino names such as jackpot and lucky 7 come round between the agents only above a speed threshold, more of them the faster it turns
    And none come round near where it will stop, so it always lands among supported agents

  @e2e
  Scenario: Read and tap comfortably on a phone or a tablet
    Given a reader on a touch screen 360, 390 or 768 pixels wide
    When they open the home page, a guide, an API operation, the changelog, a skills page or a long page
    Then the page never scrolls sideways
    And every control outside running text answers a tap anywhere in the 44 pixel square centred on it, unless a neighbouring control fills that spot
    And no visible text is smaller than 11 pixels, and article text is at least 16 pixels
    And the header's controls do not overlap one another

  @e2e
  Scenario: Show product imagery and the footer cleanly in either theme at any width
    Given a reader on a 390 or 1440 pixel wide screen in the light or dark theme
    When they open the coding agents overview and scroll to the end
    Then its product image loads as a responsive WebP and the page never scrolls sideways
    And the footer meets the bottom of the window in the page's own colour, with no overscroll bounce
    And no script error is raised
