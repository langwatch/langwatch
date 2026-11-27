Feature: Product sidebars
  As a user
  I want the sidebar to hold only the pages of the product I am in
  So that each product reads as its own coherent surface

  Both modes share one sidebar frame: pinned Quick Search first, then the
  product's own pages, then a pinned bottom block with usage, Settings,
  Support and the theme control. The product bodies reuse the same menu
  components the app has always rendered: LLM Ops and Me keep their
  sections minus the Govern group (the product switcher replaces it),
  and Gateway and Governance promote their section pages from the
  shared registry.

  The column is wide and its type is one step smaller, which is what
  lets the longer page names hold one line. The size is a property of
  the sidebar, not of the menu components. The pages scroll inside the
  column, and the scrollbar sits against the content panel with no gap.

  The rule above the bottom block is the bottom edge of the part that
  scrolls: it keeps the same distance from both edges of the column, and
  the entries pass under it and are cut there. The space between the
  last entry and the rule belongs to the scrolling part, so it is there
  when the menu rests and the entries travel through it as it moves.

  The menu moves only when it must. It keeps the place the reader put it
  while they move around the product, and it brings the open page's entry
  to the top only when that entry would otherwise be out of view. A page
  near the start of the menu opens with the first group heading on screen.
  Quick Search stays in place regardless of menu scroll. On a project page
  other than Home, which has its own search, the top bar also carries a Search
  pill with the shortcut hint; Cmd/Ctrl+K also works on full-screen tools.

  @integration
  Scenario: Quick Search sits first and opens the command bar
    Given a product sidebar
    When I use the Quick Search entry
    Then the command bar opens

  @integration
  Scenario: The top bar's Search pill opens the command bar
    Given a project page
    When I use the Search pill in the top bar
    Then the command bar opens

  @integration
  Scenario: The Home page shows no Search pill in the top bar
    Given the project's Home page
    Then the top bar shows no Search pill

  @integration
  Scenario: The LLM Ops sidebar keeps the project sections without the Govern group
    Given I am on an LLM Ops page
    Then the sidebar shows the Observe, Test and Build sections
    And the Govern group is not there

  @integration
  Scenario: The Me sidebar keeps the personal pages without the Govern group
    Given I am on a Me page
    Then the sidebar shows the personal pages
    And the Govern group is not there

  # A personal workspace belongs to one organization, so a reader in several
  # organizations owns several of them. The Traces entry addresses one by
  # project slug, and the header reads the organization back off that slug, so
  # an entry pointing at the wrong workspace also switches the organization.
  @integration
  Scenario: The Me sidebar's Traces entry stays inside the selected organization
    Given I own a personal workspace in more than one organization
    When I am on a Me page with one of them selected
    Then the Traces entry addresses that organization's personal workspace

  # Visiting a Me page creates the personal workspace in the selected
  # organization if it is missing, but the payload the sidebar reads is
  # already loaded and is not refetched, so the entry stays absent for the
  # rest of the session. Absent is the wanted outcome either way: an entry
  # addressing another organization's workspace would move the reader
  # between organizations, which is the failure the scenario above pins.
  @integration
  Scenario: The Me sidebar offers no Traces entry until it can see one here
    Given the loaded organization holds no personal workspace of mine
    When I am on a Me page
    Then there is no Traces entry

  @integration
  Scenario: The Gateway sidebar promotes the gateway pages
    Given I am on a Gateway page
    Then the sidebar lists the gateway pages from the shared registry

  @integration
  Scenario: Every gateway entry opens in the tab the reader is in
    Given the gateway pages in the shared registry
    Then no entry opens a new tab
    And no entry carries a new-tab marker

  @integration
  Scenario: The Governance sidebar promotes the governance pages
    Given I am on a Governance page
    Then the sidebar lists the governance pages from the shared registry

  @integration
  Scenario: The sidebar bottom block keeps usage, settings, support and theme
    Given a product sidebar
    Then the bottom block holds the usage indicator, Settings, Support and the theme control

  @integration
  Scenario: Chat moves inside the Support menu
    Given a product sidebar
    When I open the Support menu
    Then I see "Chat (with a human)" as the first entry
    And there is no standalone chat entry in the sidebar

  @integration
  Scenario: The sidebar draws its menu one step smaller
    Given a product sidebar
    Then the menu items use the compact type and spacing
    And the group headings use the compact heading style

  @integration
  Scenario: Dragging the sidebar's edge widens it and the width is remembered
    Given a product sidebar on a wide screen
    When I drag its right edge to the right
    Then the column widens up to its maximum width, never below its default
    And the width I picked is kept for me the next time the sidebar draws
    And double-clicking the edge puts it back to its default width

  @integration
  Scenario: A cut-off menu entry shows its full name on hover
    Given a menu entry whose name is cut off with an ellipsis
    Then hovering it shows the full name

  @integration
  Scenario: A sidebar entry underlines under the pointer
    Given a product sidebar
    When the pointer rests on a page entry
    Then the entry's label is underlined, as every in-app link is

  @integration
  Scenario: The search key cap reads as a quiet hint
    Given a product sidebar
    Then the key cap next to Quick Search is grey with a hairline border

  @integration
  Scenario: A rule separates the bottom block from the pages above it
    Given a product sidebar
    Then a rule runs above the bottom block

  @integration
  Scenario: The rule keeps the same distance from both edges of the column
    Given a product sidebar
    Then the rule starts as far from the left edge as it ends from the right
    And the entries of the bottom block line up with the entries above it

  @integration
  Scenario: The entries are cut at the rule as they scroll under it
    Given a product sidebar
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
  Scenario: Closing the Support menu with the pointer leaves no focus ring
    Given the Support menu opened because the pointer moved over it
    When the pointer moves away and the menu closes
    Then the Support entry does not keep focus
    But a keyboard close keeps focus on the Support entry

  # Owner list, 2026-10-08; reshaped by product owner feedback, 2026-10-27. Analytics lends
  # the section and draws it; navigation places it in the LLM Ops sidebar (and, behind a flag,
  # Gateway and Coding agents). A dashboard is pinned to a project by the member's star there.
  # Pins hold only with the organization's Dashboards area off; with it on no sidebar reads
  # stars (owner, 2026-11-23; "No sidebar has a Starred dashboards group" in
  # modules/dashboard/specs/dashboards-organization-area.feature).
  @integration
  Scenario: The LLM Ops sidebar has a Dashboards section listing the pinned dashboards
    Given I can reach Dashboards and I have pinned dashboards to this project
    And Dashboards in every product is off
    When I am in LLM Ops
    Then the sidebar shows a "Dashboards" section under the product's own pages
    And its title has the same style as the "Build" title
    And it lists my pinned dashboards in my order, and each entry opens that dashboard
    And a member who cannot reach Dashboards sees no such section

  @integration
  Scenario: Only the LLM Ops sidebar shows the Dashboards section
    Given I can reach Dashboards and I have pinned dashboards to this project
    And Dashboards in every product is off
    When I am in Gateway, Governance or Coding agents
    Then the sidebar shows no Dashboards section
    And the Dashboards sidebar keeps its own lists instead

  # Product request, 2026-11-18, behind release_dashboards_in_every_product (default on since 2026-11-23).
  # Gateway and Coding agents are about no project: the section works in the one LLM Ops opens.
  # Retired in S6 by "Each product's sidebar lists its own boards" in modules/dashboard/specs/dashboards-organization-area.feature.
  @integration
  Scenario: Gateway and Coding agents show the Dashboards section of the project LLM Ops opens
    Given I can reach Dashboards and Dashboards in every product is on
    And LLM Ops would open the project "Shop"
    When I am in Gateway or Coding agents
    Then the sidebar shows a "Dashboards" section for "Shop" under the product's own pages, titled with no project name
    And it lists the dashboards I pinned to "Shop"
    And Governance still shows no Dashboards section
    And a member who cannot reach Dashboards sees no such section
    And with no project for LLM Ops to open there is no such section

  # Binds the registry default; its resolution is "Dashboards in every product is on by default"
  # in modules/feature-flag/specs/feature-flag.feature.
  # Retired in S6 with the flag, by "Each product's sidebar lists its own boards" in modules/dashboard/specs/dashboards-organization-area.feature.
  @integration
  Scenario: With no setting for the flag, Gateway and Coding agents show the Dashboards section
    Given nothing sets Dashboards in every product, so it holds its registry default
    And I can reach Dashboards in "Shop", the project LLM Ops would open
    When I am in Gateway or Coding agents
    Then the sidebar shows a "Dashboards" section for "Shop" under the product's own pages, titled with no project name

  # Retired in S6 by "A product's "+" fixes the product and says where the board lives" in modules/dashboard/specs/dashboards-organization-area.feature.
  @integration
  Scenario: The plus button in Gateway or Coding agents makes the dashboard in the named project
    Given Dashboards in every product is on and I may create dashboards
    And the Dashboards section in Gateway or Coding agents works in "Shop"
    When I press the "+" at the right of the title
    Then a new dashboard is made in "Shop" and pinned to it for me
    And it opens in "Shop" with "Add a widget" open

  # Retired in S6 by "Each product's sidebar lists its own boards" in modules/dashboard/specs/dashboards-organization-area.feature.
  @integration
  Scenario: In Gateway or Coding agents, what I may do follows the named project's grants
    Given Dashboards in every product is on
    And I may only view dashboards in "Shop", whatever I may do in the page's own project
    When I am in Gateway or Coding agents and the Dashboards section works in "Shop"
    Then it offers no "+" and no "Add dashboard" item
    And a pinned dashboard's "⋮" menu offers only Unpin
    And with nothing pinned to "Shop" there is no such section

  # An organization admin reaches teams they hold no membership row in, so their grants in
  # "Shop" come from their own standing there, not from the teams they belong to.
  # Retired in S6 by "Each product's sidebar lists its own boards" in modules/dashboard/specs/dashboards-organization-area.feature.
  @integration
  Scenario: In Gateway or Coding agents, an organization admin's own grants in the named project count
    Given Dashboards in every product is on
    And I am an organization admin with no membership in the team that owns "Shop"
    And my own permissions in "Shop" let me create dashboards but not delete them
    When I am in Gateway or Coding agents and the Dashboards section works in "Shop"
    Then I may create dashboards in "Shop", so the section offers the "+"
    But I may not delete them there

  # LLM Ops may open the page's own project, whose grants the page already holds.
  # Retired in S6 by "Each product's sidebar lists its own boards" in modules/dashboard/specs/dashboards-organization-area.feature.
  @unit
  Scenario: In Gateway or Coding agents, the page's own project answers from the page's grants
    Given Dashboards in every product is on
    When the section names the page's own project
    Then what I may do there is what the page already lets me do, with no read of its grants
    And in any other named project it is what that project's own grants let me do

  # Retired in S6 by "Telemetry: boards made, moved or pinned outside a project name their owning project" in modules/dashboard/specs/dashboards-telemetry.feature.
  @unit
  Scenario: Events from the Dashboards section in Gateway or Coding agents are about the named project
    Given Dashboards in every product is on
    And the Dashboards section in Gateway or Coding agents works in "Shop"
    When something I do in the section is tracked
    Then that event is about "Shop"
    And the events after it are about the page's own project again
    And on a page about no project, the events after it are about no project

  # ADR-002's release gate: Dashboards opens per project, so the section follows "Shop", where
  # it lists and makes boards, and never the page's own project.
  # Retired in S6 by "Each product's sidebar lists its own boards" in modules/dashboard/specs/dashboards-organization-area.feature.
  @integration
  Scenario: In Gateway or Coding agents, the Dashboards section follows the named project's release flag
    Given Dashboards in every product is on
    And LLM Ops would open the project "Shop"
    When Dashboards is released for the page's own project but not for "Shop"
    Then Coding agents shows no Dashboards section and no "+"
    And when Dashboards is released for "Shop" but not for the page's own project, the section shows
    And while the page's organization is still unknown, there is no section and the release flag is not asked

  # A `?ff_release_dashboards=on|off` link answers the flag in that browser, "Shop" included.
  # Retired in S6 by "Each product's sidebar lists its own boards" in modules/dashboard/specs/dashboards-organization-area.feature.
  @integration
  Scenario: This browser's Dashboards override decides the named project's section
    Given Dashboards in every product is on
    And LLM Ops would open the project "Shop"
    When this browser opened a link with "?ff_release_dashboards=on" and "Shop" is not released
    Then Coding agents shows the Dashboards section for "Shop"
    And after a link with "?ff_release_dashboards=off", with "Shop" released, there is no section

  # Reaching Dashboards takes analytics:view where it works, so the section asks "Shop" for the
  # grant, never the page's own project.
  # Retired in S6 by "Each product's sidebar lists its own boards" in modules/dashboard/specs/dashboards-organization-area.feature.
  @integration
  Scenario: In Gateway or Coding agents, the Dashboards section follows the named project's view grant
    Given Dashboards in every product is on
    And LLM Ops would open the project "Shop"
    When I may view dashboards in the page's own project but not in "Shop"
    Then Coding agents shows no Dashboards section and no "+"
    And when I may view dashboards in "Shop" but not in the page's own project, the section shows

  # Retired in S6 by "Every product's Dashboards section has the same title, never clipped" in modules/dashboard/specs/dashboards-organization-area.feature.
  @integration
  Scenario: The LLM Ops sidebar's Dashboards section names no project
    Given Dashboards in every product is on
    When I am in LLM Ops
    Then the section is titled "Dashboards" alone and works in the project I am in

  @integration
  Scenario: Pinned dashboards in the LLM Ops sidebar stop at 7
    Given I have pinned more than 7 dashboards to this project
    And Dashboards in every product is off
    When I am in LLM Ops
    Then the Dashboards section lists the first 7, in my order
    And one more row reads "All pinned (N)", with N the number pinned, and opens Dashboards
    And with 7 pinned or fewer there is no such row

  @integration
  Scenario: A pinned dashboard in the LLM Ops sidebar has the same menu as in Dashboards
    Given I have pinned dashboards to this project
    When I open the "⋮" menu on a pinned dashboard
    Then it offers Unpin, and the Rename, Duplicate and Delete I may use on that dashboard
    And Delete asks me to confirm before it deletes the dashboard
    And a From LangWatch dashboard offers only Unpin
    And My dashboard cannot be deleted

  @integration
  Scenario: The Dashboards section's plus button makes a dashboard pinned to this project
    Given I may create dashboards in this project
    And Dashboards in every product is off
    When I press the "+" at the right of the "Dashboards" title
    Then a new dashboard opens in this project with "Add a widget" open
    And nothing is stored until its first edit, which stores it pinned to this project for me
    And a member who may not create dashboards sees no "+"

  @integration
  Scenario: With nothing pinned, the Dashboards section offers an Add dashboard item
    Given I may create dashboards and I have pinned none to this project
    And Dashboards in every product is off
    When I am in LLM Ops
    Then the Dashboards section's first item is a dotted-outline "Add dashboard" item
    And it does what the "+" does
    And with one dashboard pinned or more there is no such item
    And a member who may not create dashboards and has pinned none sees no Dashboards section

  @integration
  Scenario: A double click leaves exactly one dashboard
    Given I may create dashboards in this project
    When I press the "+" or the "Add dashboard" item twice in quick succession
    Then no dashboard is made by the presses, and the new dashboard's first edit makes exactly one

  @integration
  Scenario: A failed pin leaves exactly one dashboard
    Given I may create dashboards in this project
    When the pin fails after the new dashboard's first edit stores it
    Then that one dashboard still exists and stays open, and I see "Couldn't pin the dashboard"

  @integration
  Scenario: With the pinned list unreadable, the Dashboards section keeps its title and plus and lists nothing
    Given I may create dashboards in this project
    And the list of my pinned dashboards cannot be read
    When I am in LLM Ops
    Then the Dashboards section still shows its title and the "+"
    But it lists no dashboard and offers no "Add dashboard" item

  @integration
  Scenario: A member who may not create dashboards causes no dashboard list read
    Given I may not create dashboards in this project
    When I am in LLM Ops
    Then the sidebar reads my pinned dashboards and nothing else about dashboards

  A Dashboards page draws the sidebar of the place the reader clicked in from.
  The tab keeps one hint for that (sessionStorage, so a refresh keeps it and a
  new tab or a shared link starts without one). The address never changes.

  @unit
  Scenario: A dashboard opened from LLM Ops keeps the LLM Ops sidebar
    Given I am on an LLM Ops page
    When I open a dashboard from the sidebar or the Analytics entry
    Then the page draws the LLM Ops sidebar

  @unit
  Scenario: A deep link to a dashboard draws the Dashboards sidebar
    Given this tab has no sidebar hint
    When I open a dashboard address directly
    Then the page draws the Dashboards sidebar

  @unit
  Scenario: Refreshing a dashboard keeps the sidebar it was opened with
    Given I opened a dashboard from LLM Ops
    When I refresh the page
    Then the page still draws the LLM Ops sidebar

  @unit
  Scenario: Choosing Dashboards in the product switcher or icon rail draws the Dashboards sidebar
    Given I am on an LLM Ops page
    When I choose Dashboards in the product switcher or the icon rail
    Then the page draws the Dashboards sidebar

  @unit
  Scenario: Leaving for Gateway resets the hint
    Given I opened a dashboard from LLM Ops
    When I open a Gateway page and then open a dashboard address
    Then the page draws the Dashboards sidebar

  @unit
  Scenario: A sidebar hint from another project is ignored
    Given I opened a dashboard from LLM Ops in one project
    When I open a dashboard address in another project or organization
    Then the page draws the Dashboards sidebar
    And the device remembers "dashboards" for that organization

  @unit
  Scenario: A sidebar hint for an unreachable LLM Ops is ignored
    Given this tab holds an LLM Ops hint
    And my seat does not reach LLM Ops
    When I open a dashboard address
    Then the page draws the Dashboards sidebar

  @integration
  Scenario: The remembered product is the sidebar drawn
    Given I opened a dashboard from LLM Ops
    Then the device remembers "llm-ops" for the organization, not "dashboards"

  # Product owner, 2026-11-24: an organization younger than three weeks never had the old
  # Analytics, so the LLM Ops sidebar offers no Analytics entry that only leads to Dashboards.
  # The age is read from the organization's createdAt: 21 days or more shows the entry, any
  # younger hides it. Where the entry still opens the old Analytics (Dashboards out of reach,
  # an aggregate project) it stays, as it is the only way there.
  @integration
  Scenario: An organization younger than three weeks has no Analytics entry in Observe
    Given the Analytics entry leads to Dashboards
    And my organization was created 2 days ago
    When I am in LLM Ops
    Then the Observe section shows no Analytics entry
    And the Trace Explorer entry is still there

  @integration
  Scenario: An organization three weeks or older keeps the Analytics entry in Observe
    Given the Analytics entry leads to Dashboards
    And my organization was created 30 days ago
    When I am in LLM Ops
    Then the Observe section shows the Analytics entry

  @integration
  Scenario: A young organization keeps the Analytics entry where it opens the old Analytics
    Given my organization was created 2 days ago
    And Dashboards is out of reach for the project
    When I am in LLM Ops
    Then the Analytics entry opens /[project]/analytics

  @unit
  Scenario: An organization created exactly 21 days ago keeps the Analytics entry
    Given my organization was created exactly 21 days ago
    Then the Analytics entry is offered

  @unit
  Scenario: An organization one millisecond short of 21 days has no Analytics entry
    Given my organization was created 21 days ago less one millisecond
    Then the Analytics entry is not offered

  @unit
  Scenario: An organization whose creation date has not arrived keeps the Analytics entry
    Given my organization's creation date is not known
    Then the Analytics entry is offered
