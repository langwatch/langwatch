Feature: Product switcher navigation
  As a user on the product-switcher navigation mode
  I want the top bar to carry the product, organization and scope
  So that the sidebar holds only the pages of the product I am in

  The product-switcher shell renders when the device mode is
  "product-switcher" and the navigation flag is on. The top bar reads,
  left to right: the logo, the product dropdown, the organization, and
  the product-native scope. The dropdown advertises each product with
  its pitch line so a first-time visitor learns what each one does.
  Settings and internal ops pages keep the current chrome until their
  own shells land.

  On small screens the sidebar keeps the responsive collapse the
  current chrome has; the hover-expanded rail behaves the same way.

  @integration
  Scenario: The product switcher lists the reachable products with their pitch lines
    Given I am on the product-switcher mode
    And I can reach LLM Ops and the Gateway
    When I open the product switcher
    Then I see "LLM Ops" with "Observe, evaluate and test your agents"
    And I see "Gateway" with "Route, meter and bill LLM usage"
    And the product I am in carries the active mark

  @unit
  Scenario: Dashboards leads the product switcher
    Given I can reach Dashboards, Me and LLM Ops
    When I open the product switcher
    Then "Dashboards" is the first product in the list

  @integration
  Scenario: A product I cannot reach is not offered
    Given I am on the product-switcher mode
    And Governance is not reachable for me
    When I open the product switcher
    Then Governance is not in the list

  @integration
  Scenario: Switching product opens that product's home
    Given I am on an LLM Ops page in the product-switcher mode
    When I pick "Gateway" in the product switcher
    Then I am sent to the Gateway home

  @integration
  Scenario: The product selector reads as a raised pill
    Given I am on the product-switcher mode
    When the top bar renders
    Then the product selector has its own surface, a border and a radius

  @integration
  Scenario: The organization and the scope start at the content column
    Given I am on the product-switcher mode
    When the top bar renders
    Then the logo and the product selector take the width of the sidebar column
    And the organization and the scope start where the content column starts
    And they stay there when the product name is longer or shorter

  @integration
  Scenario: A single organization shows as plain text
    Given I belong to one organization
    When the product-switcher top bar renders
    Then the organization name is plain text with no menu
    And an organization mark sits before the name, which carries a name's weight

  @integration
  Scenario: A multi-organization user switches organization in place
    Given I belong to two organizations
    When I pick the other organization in the top bar
    Then the device stores that organization as selected
    And the stored project selection is cleared
    And I am sent to the same product in that organization when it is reachable there

  @integration
  Scenario: The LLM Ops scope shows the project switch chip
    Given I am on an LLM Ops page in the product-switcher mode
    Then the top bar shows the current project as a chip
    And the chip opens a menu with the organization's projects

  @integration
  Scenario: The Me scope shows my name with a Personal badge
    Given I am on a Me page in the product-switcher mode
    Then the top bar shows my name with a "Personal" badge

  @integration
  Scenario: LLM Ops opens from the personal workspace
    Given I am on a Me page in the product-switcher mode
    When I open the product switcher
    Then LLM Ops is offered rather than greyed out
    And picking it opens the project I last worked in
    # The Me pages run in the personal workspace, and LLM Ops opens a
    # project of the organization. Reading the personal project as "no
    # project" left the way back into LLM Ops closed.

  @integration
  Scenario: LLM Ops opens a project I can reach when I have opened none yet
    Given I am on a Me page in the product-switcher mode
    And I have opened no project on this device
    When I pick "LLM Ops" in the product switcher
    Then I am sent to a project of a team I am allowed to open

  @integration
  Scenario: LLM Ops stays closed when the organization holds no project for me
    Given I am on a Me page in the product-switcher mode
    And no team I am allowed to open holds a project
    When I open the product switcher
    Then LLM Ops is greyed out

  @integration
  Scenario: Gateway and Governance carry no scope control
    Given I am on a Gateway page in the product-switcher mode
    Then the top bar shows no project chip and no personal badge

  @unit
  Scenario: A sticky personal workspace does not follow me onto an org-wide page
    Given the workspace I last worked in was my own personal one
    When I open a Gateway or a Governance page
    Then the page keeps the organization scope its address asks for
    And it does not render as my personal surface
    # The scope carried between pages is the workspace I was last in, not
    # something the address said. Gateway and Governance are organization-wide
    # by definition, so letting that sticky workspace decide put a Personal
    # badge, the personal sidebar and a lit-up Me in the switcher on a page
    # that is about the whole organization. Settings was already exempt for
    # the same reason.

  @integration
  Scenario: The sidebar ignores the page's auto-hide request in the new modes
    Given a page that collapses the sidebar in the current chrome
    When it renders in the product-switcher mode
    Then the sidebar stays expanded

  @unit
  Scenario: A project whose slug reads like a product keeps the project shell
    Given a project whose slug starts with the name of a top-level product
    When I open one of its pages
    Then the page renders as a project page in the LLM Ops product
    And it does not render as the personal or the settings surface

  @integration
  Scenario: The project menu opens with a focused search field
    When I open the project menu
    Then a search field sits at the top of the menu and holds the focus
    And this holds however many projects the organization has

  @integration
  Scenario: Typing filters the projects by name across every team
    Given the project menu is open
    When I type part of a project's name or its team's name
    Then the menu lists only the matching projects, in their team groups
    And a team group with no matching project is hidden
    And "New Project" is hidden while I have text in the field

  @integration
  Scenario: No project matches what I typed
    Given the project menu is open
    When I type text that matches no project
    Then the menu shows one line: No projects match the text I typed

  @integration
  Scenario: The project search answers the keyboard
    Given the project menu is open
    When I move down the list with the arrow keys and press Enter
    Then the highlighted project opens

  @integration
  Scenario: Typing highlights the top result
    Given the project menu is open
    When I type enough of a project's name to narrow the list
    Then the first result is already highlighted, with no arrow key pressed
    When I press Enter
    Then that project opens

  @integration
  Scenario: Escape clears the search before it closes the menu
    Given the project menu is open
    And I have typed text in the search field
    When I press Escape
    Then the field is empty and the menu is still open
    When I press Escape again
    Then the menu closes

  @integration
  Scenario: Creating a project stays available while the list is unfiltered
    Given I may create projects in a team
    When I open the project menu without typing
    Then each team I can create a project in offers "New Project"

  @integration
  Scenario: A later navigation keeps the chrome while the workspace re-settles
    Given the chrome has drawn once
    When I navigate somewhere that makes my session or permissions read again
    Then the sidebar and top bar stay on screen
    And the page area is blank until the read settles, never the full loading splash

  # Product accents: the design system holds one map from product to accent
  # (packages/design-system/src/system/product-colours.ts). Navigation only
  # declares which product the address in view belongs to; the shell mounts that
  # declaration around the page, the open drawer and the footer together.

  @unit
  Scenario: Every registered product has an accent assignment and no other does
    Given the product registry and the design system's product colour map
    Then both name the same products

  @integration
  Scenario: The address in view names the product whose accent every surface reads
    Given the host services read an address under Me, LLM Ops, Gateway or Governance
    When a surface reads its product accent
    Then it reads that product's accent

  @integration
  Scenario: Settings, ops and an unreadable address reset to the unscoped accent
    Given the host services read a settings address, an ops address, the root, or no address
    When a surface reads its product accent
    Then it reads the unscoped accent and not the last product visited

  @integration
  Scenario: A page, the open drawer and a portalled menu read the same accent
    Given I am on a Me page with a routed drawer open
    When the page, the drawer and a menu portalled outside the page read their accent
    Then all three read the Me accent

  @integration
  Scenario: Changing product keeps the page's draft input
    Given I have typed into an input on a Me page
    When I move to a Gateway page that keeps the input mounted
    Then the accent changes to Gateway
    And the input is the same element with the text I typed

  @integration
  Scenario: The composition's presentation provider wraps the page, the drawer and the footer
    Given a composition that installs a presentation provider
    When a page, an open drawer and the footer render
    Then each of them reads what the provider supplies

  @integration
  Scenario: A composition with no presentation provider draws the page as before
    Given a composition that installs no presentation provider
    When a page renders
    Then the page renders unchanged

  @integration
  Scenario: The installed shell gives the page and the open drawer the product of the address
    Given the application shell with navigation's presentation provider
    When a page and a routed drawer open on a Me address and on a settings address
    Then both read the Me accent on the Me address
    And both read the unscoped accent on the settings address

  @integration
  Scenario: The switcher, rail and sidebar stay neutral inside any product scope
    Given the icon-rail shell inside a Me scope
    Then the active tile keeps its neutral selected surface
    And no navigation element is painted from a product colour

  @integration
  Scenario: A primary action draws the product's accent and nothing else changes
    Given a footer with a primary, a secondary, a destructive action and Cancel
    When it renders inside each product scope or none
    Then only the primary action takes the product's accent
    And Cancel, the secondary action and the destructive action keep their treatment

  @integration
  Scenario: A destructive primary stays red in every product
    Given a footer whose primary action is destructive
    When it renders inside a Me scope
    Then the primary action is red

  @integration
  Scenario: A page header's buttons stay outlined in every product
    Given a page header with a primary button and a plain button
    When it renders inside each product scope or none
    Then both buttons are outlined and neither takes the product's accent
