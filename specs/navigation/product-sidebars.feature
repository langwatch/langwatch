Feature: Product sidebars in the new navigation modes
  As a user on a new navigation mode
  I want the sidebar to hold only the pages of the product I am in
  So that each product reads as its own coherent surface

  Both new modes share one sidebar frame: Quick Search first, then the
  product's own pages, then a pinned bottom block with usage, Settings,
  Support and the theme control. The product bodies reuse the same
  components the current chrome renders, so the two presentations
  cannot drift: LLM Ops and Me keep their current sections minus the
  Govern group (the product switcher replaces it), and Gateway and
  Governance promote their section pages from the shared registry.

  The column is wider than the current chrome's and its type is one step
  smaller, which is what lets the longer page names hold one line. The
  size is a property of the sidebar, not of the menu components, so the
  current chrome keeps its own size unchanged. The pages scroll inside
  the column, and the scrollbar sits against the content panel with no
  gap.

  The rule above the bottom block is the bottom edge of the part that
  scrolls: it keeps the same distance from both edges of the column, and
  the entries pass under it and are cut there. The space between the
  last entry and the rule belongs to the scrolling part, so it is there
  when the menu rests and the entries travel through it as it moves.

  The menu moves only when it must. It keeps the place the reader put it
  while they move around the product, and it brings the open page's entry
  to the top only when that entry would otherwise be out of view. A page
  near the start of the menu therefore opens with Quick Search and the
  first group heading still on screen.

  On a small screen the column collapses to a narrow icon rail that
  widens again while the pointer is over it. The content stays laid out
  at the full width and the column clips it, so collapsing slides the
  same content out of view rather than reflowing it, and nothing may
  move that content sideways behind the user's back.

  @integration
  Scenario: Quick Search sits first and opens the command bar
    Given a product sidebar in a new navigation mode
    When I use the Quick Search entry
    Then the command bar opens

  @integration
  Scenario: The LLM Ops sidebar keeps the project sections without the Govern group
    Given I am on an LLM Ops page in a new navigation mode
    Then the sidebar shows the Observe, Test and Build sections
    And the Govern group is not there

  @integration
  Scenario: The Me sidebar keeps the personal pages without the Govern group
    Given I am on a Me page in a new navigation mode
    Then the sidebar shows the personal pages
    And the Govern group is not there

  @integration
  Scenario: The Gateway sidebar promotes the gateway pages
    Given I am on a Gateway page in a new navigation mode
    Then the sidebar lists the gateway pages from the shared registry

  @integration
  Scenario: Every gateway entry opens in the tab the reader is in
    Given the gateway pages in the shared registry
    Then no entry opens a new tab
    And no entry carries a new-tab marker

  @integration
  Scenario: The Governance sidebar promotes the governance pages
    Given I am on a Governance page in a new navigation mode
    Then the sidebar lists the governance pages from the shared registry

  @integration
  Scenario: The sidebar bottom block keeps usage, settings, support and theme
    Given a product sidebar in a new navigation mode
    Then the bottom block holds the usage indicator, Settings, Support and the theme control

  @integration
  Scenario: Chat moves inside the Support menu in the new modes
    Given a product sidebar in a new navigation mode
    When I open the Support menu
    Then I see "Chat (with a human)" as the first entry
    And there is no standalone chat entry in the sidebar

  @integration
  Scenario: The current chrome keeps the standalone chat entry
    Given the current chrome on the cloud version
    Then the sidebar shows the standalone "Chat" entry
    And the Support menu has no chat entry

  @integration
  Scenario: The sidebar draws its menu one step smaller
    Given a product sidebar in a new navigation mode
    Then the menu items use the compact type and spacing
    And the group headings use the compact heading style
    And the column is wider than the current chrome's menu

  @integration
  Scenario: The current chrome keeps its own menu size
    Given the current chrome
    Then the menu items keep the comfortable type and spacing
    And the group headings keep the comfortable heading style

  @integration
  Scenario: The search key cap reads as a quiet hint
    Given a product sidebar in a new navigation mode
    Then the key cap next to Quick Search is grey with a hairline border

  @integration
  Scenario: A rule separates the bottom block from the pages above it
    Given a product sidebar in a new navigation mode
    Then a rule runs above the bottom block

  @integration
  Scenario: The rule keeps the same distance from both edges of the column
    Given a product sidebar in a new navigation mode
    Then the rule starts as far from the left edge as it ends from the right
    And the entries of the bottom block line up with the entries above it

  @integration
  Scenario: The entries are cut at the rule as they scroll under it
    Given a product sidebar in a new navigation mode
    Then the part that scrolls ends at the rule
    And the space above the rule scrolls with the entries

  @integration
  Scenario: Opening a page whose entry is in view leaves the menu alone
    Given I open a product page whose entry is in view
    Then the menu does not scroll
    And Quick Search and the group heading above the entry stay in view

  @integration
  Scenario: Opening a page below the fold reveals its sidebar entry
    Given I open a product page whose entry is below the fold
    Then the sidebar brings that page's entry into view
    And the entry sits as near the top of the menu as the menu allows

  @integration
  Scenario: The menu keeps its place while I move around the product
    Given I scroll the menu to reach a page further down
    When I open that page
    Then the menu is where I left it

  @integration
  Scenario: Moving inside the menu leaves the scroll where it is
    Given a page is open and its entry is already in view
    When I open another page from the same menu
    Then the menu does not scroll

  @integration
  Scenario: A reader who scrolls the menu keeps the position they chose
    Given I open a product page by its address
    When I scroll the menu myself
    And the menu keeps growing while its remaining groups arrive
    Then the menu stays where I put it

  @integration
  Scenario: The collapsed sidebar keeps its icons still until it is hovered
    Given a collapsed sidebar on a page opened by its address
    Then revealing that page's entry cannot shift the collapsed column
    And the icons keep the same inset before and after the first hover

  @integration
  Scenario: Closing the Support menu with the pointer leaves no focus ring
    Given the Support menu opened because the pointer moved over it
    When the pointer moves away and the menu closes
    Then the Support entry does not keep focus
    But a keyboard close keeps focus on the Support entry
