Feature: Organization-wide Dashboards area
  # Sources: tasks#1211 comment 2026-11-19; the approved design; ADR-002 (amended);
  # product decisions D1-D5 of 2026-11-21.
  #
  # Spec first (ADR-002, amended): every scenario is @unimplemented until the slice that builds
  # it binds a test and drops the tag. The other tags name the level it binds at.
  # @q1-all-projects rests on product decision D1. A home product is a column on the board row,
  # not an event (ADR-002, decision 8 as built; see the scenario on boards made before homes).
  # "The organization's Dashboards area" is the flag release_dashboards_organization_area (ADR-002,
  # decision 6); "Dashboards in every product" is release_dashboards_in_every_product, which
  # governs only the other products' sidebar sections. Both need release_dashboards.
  # Owner, 2026-11-23: "we can drop starred... If it's in the project + product, it goes on the
  # sidebar." Stars stay stored (column, repository, API); no screen in the area reads or writes them.
  # A "# Next PR" line marks a scenario this PR (S0: the library, the sidebars and the
  # org-level routes) leaves to the next: home products (decision 8, with their chrome, product
  # templates and moves) and every @q1-all-projects scenario. Each keeps @unimplemented.
  # Every scenario names its evidence: a haven browser screenshot for UI, the quoted tRPC answer
  # or run params for server rules. "Test passes" is never evidence. Every UI scenario's
  # screenshots are taken in light and dark.

  Background:
    Given an organization "Acme" with projects "Shop" and "Ops", where release_dashboards is on
    And I read both projects unless a scenario says otherwise
    And "the organization's Dashboards area" is on unless a scenario says otherwise
    And the expanded sidebar is 212px wide

  # ---- Flag off: nothing new beyond PR 9698's rename and /me redirects (B8) ----
  @integration
  Scenario: With the flag off, /dashboards forwards to my project as before
    Given "the organization's Dashboards area" is off for "Acme"
    When I open "/dashboards"
    Then I land on my last-used project's address, as the base commit of PR 9698 does, and no library page is drawn
    # Evidence: the address after the forward

  @integration @unimplemented
  Scenario: With the flag off, the Dashboards area is as it was
    Given "the organization's Dashboards area" is off
    When I open "/dashboards", "/dashboards/<a board id>", "/dashboards/templates" or "/dashboards/curated/<id>"
    Then I see the same page the base commit of PR 9698 shows for that address
    And the Gateway, Governance and Coding agents sidebars are as the base commit draws them: the project's Dashboards section only where "Dashboards in every product" is on, and no "Starred dashboards" group
    And the LLM Ops sidebar's Dashboards section lists my pins, at most 7, its "+" opens a new board stored on its first edit, and it has no "Browse templates"
    And the Dashboards sidebar at "/shop/dashboards" is the one dashboards-v1 AC3 describes
    And "/shop/dashboards" lands on my My dashboard of "Shop", as today
    And switching project in the top bar on an Organization board at "/shop/dashboards/<id>" keeps the board open, re-read for the project switched to (D2)
    And a not-available page shows AC183's text and no "Back to Dashboards"
    And a board moved to Gateway while the flag was on is listed in LLM Ops again
    And a Project board its author moved out while the flag was on lists in LLM Ops as Only me, for its author alone
    And my personal boards are not shown anywhere, and none is deleted
    And "Coding agents" replaces "Me", and "/me" addresses redirect to "/coding-agents"
    # Evidence: one screenshot per address and sidebar above with the flag off, each paired
    # with the base commit's screenshot of the same address

  @integration
  Scenario: With the flag off, a board's title has no inline rename, as on main
    Given "the organization's Dashboards area" is off for "Acme"
    When I open a stored board in "Shop"
    Then its title is drawn with no rename control
    # Evidence: the rendered title with no button in it

  @integration
  Scenario: With the flag off, an Organization board keeps the Project chip, as on main
    Given "the organization's Dashboards area" is off for "Acme"
    When I open an Organization board in "Shop"
    Then the header shows the Project chip "Project: Shop" and no "Data from" label
    # Evidence: the chip's aria-label in the rendered header

  @integration
  Scenario: An Organization board in a project reads its data from a label, not a chip
    Given "the organization's Dashboards area" is on for "Acme"
    When I open an Organization board in "Shop"
    Then the header shows "Data from Shop" and no Project chip
    # Evidence: the label's aria-label in the rendered header

  @integration
  Scenario: With the flag off, a From LangWatch board is read-only until Make a copy
    Given "the organization's Dashboards area" is off for "Acme"
    And I may create and update dashboards in "Shop"
    When I open "/shop/dashboards/curated/<id>"
    Then the board shows its widgets with no "Add a widget", no "Use this template", no title or description edit, and no widget edit, drag or delete
    And it offers "Make a copy" (dashboards-v2.feature), and no copy-on-change dialog can open
    # Evidence: the quoted tRPC calls, with no dashboards or dashboardWidgets write unless
    # the member presses Make a copy

  @integration
  Scenario: Make a copy explains and retries when the saved boards fail to load
    Given "the organization's Dashboards area" is off for "Acme"
    And I may create and update dashboards in "Shop", and my saved boards fail to load once
    When I open "/shop/dashboards/curated/<id>"
    Then "Make a copy" is disabled, and the header says a copy can't be named yet, with "Retry"
    When I press "Retry" and the boards load
    Then "Make a copy" is enabled and the message is gone

  @integration
  Scenario: Make a copy is not offered to a member who may create but not update
    Given "the organization's Dashboards area" is off for "Acme"
    And I may create but not update dashboards in "Shop"
    When I open "/shop/dashboards/curated/<id>"
    Then no "Make a copy" is offered, and a quiet line says who can create and edit to copy it

  @integration
  Scenario: Make a copy waits for the saved boards to load
    Given "the organization's Dashboards area" is off for "Acme"
    And I may create and update dashboards in "Shop", and the saved boards are still loading
    When I open "/shop/dashboards/curated/<id>"
    Then "Make a copy" is disabled until the saved boards load

  @integration
  Scenario: Make a copy and the quiet line wait for the organization's flags
    Given I may create and update dashboards in "Shop", and the organization's flags are loading
    When I open "/shop/dashboards/curated/<id>"
    Then neither "Make a copy" nor the quiet line shows until the flags answer

  # ---- The Coding agents rename: page titles (draft AC4; S0) ----
  @integration @unimplemented
  Scenario: Every Coding agents page title says Coding agents
    Given "the organization's Dashboards area" is on, and also when it is off
    When I open each page under "/coding-agents", and each old "/me" address that redirects there
    Then the browser tab's title names "Coding agents", never "Me"
    And the page header names "Coding agents", never "Me"
    # Evidence: a browser test that visits every "/coding-agents" route in the route table and
    # asserts on document.title and the page header text of each, with one screenshot per page

  # ---- Org level: chrome and top bar (B1, B5, S5, S6) ----
  @integration
  Scenario: The library shows only the organization in the top bar
    When I open "/dashboards"
    Then the top bar shows the organization control and no project chip
    And "Dashboards" is highlighted in the product switcher and the icon rail
    # Evidence: haven browser screenshot of /dashboards, top bar and rail in frame

  # "Project chip" is the top bar's project switcher. An LLM Ops board keeps it (D2): see
  # "An LLM Ops board or a From LangWatch board at org level".
  @integration
  Scenario: An org-level board draws its home product's chrome, with no project chip
    Given an Organization board homed in Gateway or Governance
    When I open "/dashboards/<id>" or "/shop/dashboards/<id>"
    Then the top bar shows the organization control and no project switcher
    And its product is highlighted in the switcher and the icon rail, and its sidebar shows
    When a member whose seat cannot reach Gateway opens a Gateway board's address
    Then it opens in the Dashboards chrome, with no project switcher
    And an Organization board homed in LLM Ops instead shows LLM Ops's project switcher in the top bar, on the project in view
    # Evidence: haven browser screenshots of /dashboards/<id> as both members, and of an LLM Ops board

  @integration
  Scenario: A board only its project lists switches the app to that project
    Given a Project board, or an Only me board, owned by project "Support Bot" that I read
    And "Demo" is the project in view
    When I open "/dashboards/<id>" from a sidebar section's link
    Then "Support Bot" becomes the project in view and the project I last used
    And the Dashboards sidebar lists the board, marked as the current one
    When the board is shared with the organization, has no owning project I read, or its owner is already in view
    Then the project in view stays as it is
    # Evidence: haven browser screenshot of the sidebar after opening such a board from a link

  # D2 (owner defaults, 2026-11-23): an LLM Ops board with no project reads the project in view,
  # switched from the LLM Ops top bar; Gateway and Governance boards read organization data.
  @integration @unimplemented
  Scenario: An LLM Ops board or a From LangWatch board at org level
    Given an Organization board homed in LLM Ops, and my last-used project "Shop"
    When I open "/dashboards/<id>" or "/dashboards/curated/<template id>"
    Then the LLM Ops sidebar shows, its links pointing at "Shop", and LLM Ops is highlighted
    And the top bar shows LLM Ops's project switcher on "Shop"; switching it keeps the board open and re-reads it
    And the board's header reads "Data from Shop", read-only, and its widgets read "Shop" alone
    When I have no last-used project
    Then the links point at the first project I read, by name, the board reads that project, and with none the Dashboards sidebar shows
    When I open a Gateway-homed Organization board at "/shop/dashboards/<id>"
    Then the Gateway sidebar shows, the board names no project, and its widgets read the organization's data
    # Evidence: haven screenshots of each case, sidebar link targets hovered, and the run's params

  @integration
  Scenario: An LLM Ops Organization board with no project in view reads the project it opens in
    Given an Organization board homed in LLM Ops, and no project in view
    When I open "/dashboards/<id>"
    Then the board opens at that address, its widgets read the project it opens in, and its header reads "Data from <that project>"
    # Evidence: haven browser screenshot of the header, and the run's params

  @integration
  Scenario: An LLM Ops Organization board reads the project in view, with no switcher on the board
    Given an Organization board homed in LLM Ops, owned by "Shop", and "Ops" in view
    When I open it
    Then its widgets read "Ops", not its owner, and its header reads "Data from Ops", read-only
    And the board offers no project control of its own
    # Evidence: haven browser screenshot of the header, and the run's params

  @integration
  Scenario: Switching project keeps an LLM Ops Organization board open and re-reads it
    Given an Organization board homed in LLM Ops, open with "Ops" in view
    When I switch the top bar to another project I read
    Then the same board stays open at the same address, re-read for that project, and its header names it
    # Evidence: haven browser screenshots before and after the switch, and both runs' params

  @integration
  Scenario: A Project board reads its own project, whatever project is in view
    Given a Project board of "Shop", and "Ops" in view
    When I open it
    Then its widgets read "Shop" and its header reads "Data from Shop"
    # Evidence: haven browser screenshot of the header, and the run's params

  @integration
  Scenario: A Gateway or Governance board names no project and ignores the project in view
    Given an Organization board homed in Gateway or in Governance, owned by "Shop", and "Ops" in view
    When I open it
    Then its header names no project, and the project in view does not change what it reads
    # Evidence: haven browser screenshots of both boards' headers, and the run's params

  # Owner, 2026-11-23: "templates should only be llm ops, not also on the dashboards page".
  @integration
  Scenario: The Dashboards sidebar at org level
    When I open "/dashboards"
    Then the Dashboards sidebar lists "All dashboards" (current), and nothing else besides Quick Search
    And it has no "Templates" entry: templates are offered only in LLM Ops
    # Evidence: haven browser screenshot of the sidebar

  @integration
  Scenario: The Templates page at org level
    When I open "/dashboards/templates"
    Then the template gallery shows, with no project chip
    When I add a template
    Then a board named after the template is made at once, with no dialog, Only me, homed in LLM Ops, stored in my store project
    And a toast says "Created "<name>"" and the board opens
    When I add the same template again
    Then the new board's name has a number added, so no two share a name
    # Evidence: screenshots of the gallery and the toast, and the quoted create answers

  @unit
  Scenario: Switching organization on an org-level page
    Given I belong to "Acme" and to a second organization "Beta"
    When I switch organization to "Beta" on "/dashboards/<id>"
    Then I land on "/dashboards" of "Beta"
    # Evidence: haven browser screenshot after the switch, address bar in frame

  @integration
  Scenario: A Developer seat can open the library
    Given my seat in "Acme" is Developer, so I read only my own personal project (ADR-171)
    When I open "/dashboards"
    Then the library request is answered, not refused: a Developer seat holds organization:view through the organization floor
    And it lists my personal project's Project boards, my personal boards and the Organization boards, those with no project named, and no Project board of "Shop" or "Ops"
    And an Organization board of "Shop" opens in my personal project
    # Evidence: the quoted boards.listInOrganization answer and the run's params, and a screenshot of the library

  # ---- Library (B10, S4, S10; E12, E13, E15, E16) ----
  # What this PR ships of the library; the scenarios marked "# Next PR" below add the rest.
  @integration
  Scenario: The library lists the boards I may see, with who sees each and its owner
    When I open "/dashboards"
    Then the header reads "Dashboards" with "Every dashboard you can see, by product."
    And its table lists the LLM Ops boards with no project first, then the rest by project
    And each row names who sees it: the project's name, "Organization", or "Only me"
    And each row names its owner, "You" for mine, else its author's name
    And every board opens at "/dashboards/<id>", a Project board included (owner, 2026-11-23)
    # Evidence: haven browser screenshots of the library, light and dark

  @integration
  Scenario: A board made in the library is made at its scope in one write
    When I press "New dashboard" in the library and create a board with a name and who can see it
    Then it opens unsaved at "/dashboards/new" and nothing is written (dashboards-v2 AC162)
    When I make its first edit
    Then it is stored in my store project at that scope, in one write
    And the address moves to "/dashboards/<id>" without reloading the board, whatever its scope, a Project board included (owner, 2026-11-23)
    And a seat that may create dashboards there but not update them is refused an Only me or Organization board, and nothing is written
    # Evidence: the quoted boards.create and boards.createAtScope answers, and the refusal

  # Owner, 2026-11-24: Quick Search's "Create a dashboard" opens "the dialog already".
  @integration
  Scenario: The library opened to create a dashboard opens its create dialog
    Given I may create a dashboard in "Shop"
    When I open "/dashboards?new=1", as Quick Search's "Create a dashboard" does
    Then the library shows with the create dialog open, and the address drops "?new=1" in place
    And going back or refreshing does not open the dialog again
    And creating the board opens it at "/dashboards/<id>"
    # Evidence: screenshots of the dialog over the library and of the new board, and the address

  @integration
  Scenario: Delete, rename and duplicate from the library
    When I delete a board I may delete and confirm
    Then it is deleted in its own project and a toast says ""<name>" deleted"
    And an Organization board of a project I cannot read offers no Delete
    And no row offers Star, Unstar or a star toggle, a board I starred before included
    When I rename a board I may edit
    Then Enter saves the name in place in its own project and says "Dashboard renamed", and Escape saves nothing
    And a board of a project where I may not edit offers no Rename
    When I duplicate a board
    Then the copy, "<name> copy", is stored in my store project at the board's scope and opens
    # Evidence: the quoted delete, update and create answers, and screenshots of the toasts

  # Request from the dashboards team, 2026-11-26: "a better design and search / filtering setup
  # on the dashboards table". One table replaces the per-product groups; Product is a column and
  # a filter, so the folding groups and their "Show N more" are gone from the library.
  @integration
  Scenario: The library lists every board I may see in one table
    Given boards homed in LLM Ops, Coding agents, Gateway and Governance
    When I open "/dashboards"
    Then the header reads "Dashboards" with "Every dashboard you can see, by product."
    And one table lists them with the columns Name, Product, Shared with, Owner and Updated
    And the rows follow the rail's product order: Coding agents, LLM Ops, Gateway, Governance
    And within a product, boards with no project come first, then by project name, then by board name
    And a row shows the board's description under its name, when it has one
    And "Shared with" names the project, "Organization", or "Only me" with a lock
    And "Owner" reads "You" for mine
    And a project name too long for its column, such as "Checkout conversion and refunds EU", ends with "…" and shows in full on hover
    # Evidence: haven browser screenshots of the library, light and dark, plus one hover

  @unit @integration
  Scenario: The library's search finds a board by its name, description, project or owner
    Given boards named "Refund rate" and "Latency", one described as "Weekly refunds review"
    When I type "refund" in "Search dashboards"
    Then only the boards whose name, description, project name or owner name holds "refund" are listed, whatever the case
    And the toolbar says how many of all the boards it shows, such as "2 of 5 dashboards"
    # Evidence: haven browser screenshot with the search typed

  @unit @integration
  Scenario: The library's filters narrow it by product, owner and who sees it
    Given boards in several products, some mine and some another member's, at each scope
    Then the toolbar offers product chips: "All" and each product that has a board, each with its count
    And "Created by" offers Anyone and Me, and "Shared with" offers Anyone, Only me, Project and Organization
    When I pick "Gateway", "Me" and "Organization"
    Then only my Organization boards homed in Gateway are listed
    And the search and the filters narrow the list together
    And "Clear filters" shows while any is set, and puts the search and every filter back
    And with nothing matching, the library says "No dashboards match these filters" and offers "Clear filters"
    # Evidence: haven browser screenshot with filters picked, and one of no match

  @unit @integration
  Scenario: The library sorts by name or by last change
    When I press the "Name" column header
    Then the boards are listed by name, A to Z, and pressing it again lists them Z to A
    When I press the "Updated" column header
    Then the most recently changed board comes first, and pressing it again puts the oldest first
    And until I press a header the rows keep the product order
    # Evidence: haven browser screenshot of the table sorted by Updated

  @integration
  Scenario: The library leaves out what I may not see
    Given another member's Only me board, a Project board of a project I cannot read,
      and boards of a project where Dashboards is off
    When I open "/dashboards"
    Then none of them is listed
    And an Organization board whose project I cannot read is listed with no project named
    And an Organization board of an archived project is not listed
    # Evidence: the quoted boards.listInOrganization answer for that member

  @integration @unimplemented
  Scenario: A library row's menu offers what I may do
    Given my Organization board homed in Gateway, owned by "Shop", where I hold analytics:update and analytics:delete
    Then its menu offers Rename, Move to product…, Duplicate and Delete
    And Rename edits the name in place: Enter or leaving the field saves it and says "Dashboard renamed", Escape cancels
    And My dashboard offers "Move to product…", and shows "Delete" disabled, saying "Your default dashboard can't be deleted"
    And the server refuses a delete of My dashboard with "dashboard_default_not_deletable"
    # The hover on My dashboard's Delete is an addition: the approved design disables it with no hover
    # Evidence: haven browser screenshots of each menu and hover

  @integration
  Scenario: A copy from the library keeps the board's product and scope
    When I duplicate an Organization board homed in Gateway
    Then the copy is homed in Gateway, at Organization, stored in my store project, and it opens at "/dashboards/<copy id>"
    # Evidence: the quoted boards.createAtScope input and the address after the copy

  # Next PR: the copy stored in the board's own project, a Project copy opening at its project
  # address, Duplicate disabled without create rights, and the dashboard_last_in_product refusal.
  @integration @unimplemented
  Scenario: Duplicate and Delete from the library
    When I duplicate my Organization board homed in Gateway, owned by "Shop" where I may create
    Then a toast says "Duplicated as "<name> copy"", and the copy is homed in Gateway, Organization, mine, stored in "Shop", and it opens
    When I duplicate an Organization board of "Ops" where I may not create
    Then the copy is Organization, stored in my store project
    When I duplicate an LLM Ops Project board of "Shop" where I may create
    Then the copy is Project, stored in "Shop", and it opens at "/shop/dashboards/<copy id>"
    And on a Project board of a project where I may not create, Duplicate is disabled, saying "You can't make dashboards in <project>."
    When I delete a board and confirm
    Then a toast says ""<name>" deleted", it leaves the library and its sidebar, and its id reads "This dashboard was deleted or isn't shared with you."
    When I try to delete the last board I can see in a product in this organization, counting Project, Organization, Only me and personal boards
    Then nothing is deleted and a toast says "You can't delete your last dashboard"
    And the same delete sent to the server is refused with "dashboard_last_in_product"
    # Evidence: the quoted create and delete answers and the refusals, and screenshots of the toasts and pages

  # Owner, 2026-11-23: "I think we can also remove 'From LangWatch' for now as well. It's a bit
  # confusing." Removed for now from the library and every sidebar; the boards still open by address.
  @integration
  Scenario: From LangWatch boards are not listed for now
    Given the organization's Dashboards area is on
    When I open "/dashboards", or any product's Dashboards section
    Then no "From LangWatch" group or row is listed, in the library or in any sidebar
    And "/dashboards/curated/<template id>", "/shop/dashboards/curated/<template id>" and the templates page still open, so old links work
    # Evidence: haven browser screenshots of the library and the LLM Ops sidebar

  @integration
  Scenario: An empty library
    Given I may see no board
    Then "/dashboards" reads "No dashboards yet" and "Make one for any product. It shows in that product's sidebar."
    And it offers "New dashboard" when I may create
    # Evidence: haven browser screenshot

  # ---- Data at org level vs project view (1211; D1) ----
  # D2: a Gateway or Governance board reads the organization; an LLM Ops board reads the project in view.
  @unit @integration
  Scenario: A Gateway or Governance board's widget reads every project I may read
    Given an Organization board homed in Gateway or Governance, whose widget stores no projects
    When I open it
    Then the widget's run asks for projects "all", and its header names no project
    And a widget that stores its own projects asks for those projects instead
    And with release_dashboards_organization_area off, the run asks for no projects, the header keeps
      the Project chip and an empty board offers its templates, as before
    # Evidence: the run's params with the flag on and off, and a screenshot of each header

  # Next PR: "All projects" at the organization level (ADR-002, decision 9; D1).
  @unit @integration @q1-all-projects @unimplemented
  Scenario: "All projects" leaves out what I may not read
    Given "Acme" also has an archived project "Old", a project "Secret" I cannot read,
      a project "Lab" I read where Dashboards is off, and its hidden governance project holding Gateway traces
    When an org-level board's widget that stores no projects runs
    Then {dashboard_context_projects:Array(String)} is bound to exactly "Lab", "Ops" and "Shop"
    And no row comes from "Old", "Secret" or the governance project
    And my own personal project is included, and no other member's personal project is, even when an organization admin runs it
    And the board's project chip does not offer another member's personal project to the organization admin
    And a LangWatchQL REST run with projects "all" by the same admin binds the same list
    # Evidence: the run's params and a row count per project, for a member and for an organization admin
    # "Lab" is in: "all" is a data read under analytics:view; release_dashboards gates the area.

  @integration @security @unimplemented
  Scenario: An org-level board reads Gateway traces in the governance project, for the keys I can see
    Given "Acme"'s governance project is the trace destination of virtual keys "K1" (a team key I can see) and "K2" (another member's team key I cannot see)
    And "P1", another member's personal key, also sends its traces there
    And "M1", my own personal key, also sends its traces there
    And an org-level Gateway board with a chart that names no project
    When I open it as a member who holds gatewayUsage:view
    Then the chart counts the traces of "K1" and not of "K2", and its figure for "K1" equals K1's Gateway Usage page for the same period
    And it counts "M1", and leaves out "P1" even though my Gateway pages list "P1"
    And a chart whose query is "SELECT count() FROM traces" counts my K1 traces and none of K2's
    And a chart that totals spend with no grouping includes K1 and not K2
    And a chart that reads coding_session_events, logs or governance_security_events gets no row from the governance project
    And a chart that reads gateway_budget_totals gets no row from the governance project
    And a run that does not come from an organization board I can open reads no governance row, whatever its input says
    And a governance trace with no virtual key id is never counted
    And no chip, card line, project list, error or response field shows the governance project's name, slug or id
    And a chart grouped by project shows the Gateway rows as one row with an internal id and no name
    When a member who holds gatewayUsage:view but not cost:view opens it
    Then it sees K1's request count and no spend, as on K1's Gateway Usage page
    When a member who holds gatewayUsage:view but sees no virtual key opens it
    Then the chart has no row from the governance project, and the card reads "All projects" as before
    When a member who sees "K1" through a team but lacks gatewayUsage:view opens it
    Then the chart has no row from the governance project
    When an organization admin opens it
    Then it counts "K1" and "K2" and leaves out "P1", while the admin's Gateway pages list "P1"
    And it leaves out "M1"
    And for "K1" the figure equals K1's Gateway Usage page for the same period
    When the owner of "P1" is erased
    Then no board starts counting "P1"
    When "K1" is revoked
    Then its past traffic still counts, as on its Gateway Usage page
    When the key list cannot be read
    Then the chart shows "Couldn't load" with Retry and no figures
    And with release_dashboards_organization_area off, no run reads the governance project
    And the same board in the project view of "Shop" reads no governance trace
    And a LangWatchQL REST run with projects "all" binds no governance project, as before
    # Evidence: screenshots, signed in as each member, of the board's chart for K1 next to K1's Gateway Usage page (same period, same figure); of the hostile "count() FROM traces" chart; of the keyless member's chart; of my chart with M1 and without P1; and of the admin's chart without P1 and M1. The run response for each, showing params.dashboard_context_projects without the governance id.

  # Owner, 2026-11-25: the board says whose data it shows, so a card names its projects only
  # where they differ from the board's.
  @unit @integration
  Scenario: A widget's card names its projects only where they differ from the board's
    Given a board reading "Shop"
    When a widget's query stores no projects, or stores "Shop" alone
    Then its card line names no project
    When a widget's query stores "Ops", or "Shop" then "Ops"
    Then its card line reads "Project: Ops", or "Projects: Shop, Ops"
    And on a Gateway or Governance board, which reads every project, a card names projects only where its query stores some
    # Evidence: haven browser screenshots of a board in "/shop/dashboards" with no card project
    # line, and of a board at "/dashboards/<id>" where only the widget reading "Ops" names it

  @integration
  Scenario: A board in a project's own Dashboards names only other projects on its cards
    Given a board opened at "/shop/dashboards/<id>" whose widgets store no projects
    Then no card line names "Shop"
    When a widget there stores "Ops" in its query's projects
    Then that card alone reads "Project: Ops"
    # Evidence: a haven browser screenshot of the board's cards

  @unit @integration @unimplemented
  Scenario: The project view of the same board is filtered to that project
    Given the same Organization board
    When I pick "Shop" in its chip, or open "/shop/dashboards/<id>"
    Then it is the same board and the run reads "Shop" alone, with no project on the card line
    And a widget that stores its own projects reads those projects in both views
    # Evidence: the run's params in both views, and two screenshots

  # Next PR: "All projects" at the organization level (ADR-002, decision 9; D1).
  @integration @q1-all-projects @unimplemented
  Scenario: Reading more than 100 projects says so on the card
    Given I read 101 projects of "Acme"
    When an org-level board's widget that stores no projects runs
    Then that card shows: You can read 101 projects, more than the 100 one run may read with "all". Name up to 100 of them in `projects`.
    And a widget that stores its own projects on the same board still draws
    # Evidence: a screenshot of both cards; message from langwatch-ql-readable-projects.service.ts:73-76

  # Removed for now (owner, 2026-11-23): "I think we can also remove 'From LangWatch' for now as
  # well. It's a bit confusing." No library row or sidebar group opens one; the address still does.
  # Next PR: "All projects" at the organization level (ADR-002, decision 9; D1).
  @integration @q1-all-projects @unimplemented
  Scenario: A From LangWatch board's address opens at the organization level
    When I open "/dashboards/curated/<template id>" from an old link
    Then it opens at "/dashboards/curated/<template id>", read-only, in the LLM Ops sidebar, with no project chip
    And its widgets read every project I may read
    And "Duplicate to edit" makes an Only me copy homed in LLM Ops, named "<name> (copy)", stored in my store project
    # Evidence: the address, the run's params, and a screenshot of the read-only board

  # ---- What a project view lists (1211: "the same org-level dashboards, scoped to that project") (B2, B3) ----
  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: Dashboards inside a project lists the organization's boards, read for that project
    Given an Organization board homed in Gateway, owned by "Ops"
    And a Project board of "Shop" and an Only me board of mine made in Coding agents
    When I open Dashboards, or the Analytics entry, in "Shop"
    Then the Dashboards sidebar lists the Gateway board in "From Acme" and the Project board
    And opening the Gateway board shows "/shop/dashboards/<id>" with each widget reading "Shop" alone
    And the Coding agents board is listed only in the library and the Coding agents sidebar
    # Evidence: haven browser screenshot of /shop/dashboards sidebar, and the run's params

  @integration
  Scenario: The LLM Ops section in a project lists the same boards, filtered
    Given LLM Ops-homed boards owned by "Shop" and by "Ops", some Project, some Organization, some Only me, one starred
    When I am in LLM Ops in "Shop"
    Then its Dashboards section shows My dashboard, then the "Shop" Project boards, every Organization board and my Only me boards homed in LLM Ops, in my own order and the rest by name, a starred one among them
    And it has no From LangWatch group
    And it lists no Project board of "Ops" and no board homed in another product
    And every board it lists is also in the library
    # Evidence: haven browser screenshot of the section next to the library's LLM Ops group

  # Default call, 2026-11-23, pending the owner's answer: the owner saw "My dashboard" twice in
  # the LLM Ops sidebar, one from each project the member reads. The library still lists both.
  @integration
  Scenario: The sidebar lists only my My dashboard for the project I am in
    Given my own My dashboard of "Shop", another of "Ops", and another member's My dashboard shared with the organization
    When I am in LLM Ops in "Shop"
    Then its Dashboards section lists my My dashboard of "Shop" and not the one of "Ops"
    And the other member's My dashboard is listed as before
    # Evidence: haven browser screenshot of the section

  # ---- Personal boards (E1, E2) ----
  @integration @unimplemented
  Scenario: My dashboard is mine in every project
    Given my My dashboard has a widget that stores no projects
    When I open "/shop/dashboards"
    Then My dashboard opens, reading "Shop"
    When I switch project to "Ops"
    Then My dashboard stays open, now reading "Ops", at the same id
    # Evidence: the address and the run's params before and after the switch

  @integration @unimplemented
  Scenario: Earlier per-project My dashboards are kept
    Given I had a My dashboard in "Shop" and in "Ops" before this change
    When I open Dashboards in "Shop" for the first time with the flag on
    Then my personal My dashboard starts with the widgets of my "Shop" one
    And both earlier ones still exist, listed in the library's LLM Ops group as "My dashboard · Shop" and "My dashboard · Ops", Only me
    # Evidence: the list answer, and screenshots of the section

  @unit @integration @unimplemented
  Scenario: Coding agents boards follow me across organizations
    Given I belong to "Acme" and "Beta"
    And I make an Only me board "Agent spend" in Coding agents while in "Acme"
    When I switch organization to "Beta"
    Then "Agent spend" is in Beta's Coding agents sidebar and library, at the same id
    And its widgets that store no projects read only the projects of "Beta" I may read
    And a widget that names projects of "Acme" reads nothing in "Beta" and says "This widget names projects of another organization."
    And no member of "Acme" or "Beta" but me can list or open it
    And in an organization where I read no project, the board still opens and each card says "You can read no project in <organization>, so there is nothing to show."
    # Evidence: the run's params in both organizations, the quoted refusal for another member, and screenshots

  @unit @unimplemented
  Scenario: A personal board is reachable only by its owner
    Given another member's personal board id
    When I open it at any address, or call its read or write procedures with it
    Then the answer is the same as for a board that does not exist
    And the owner is taken from my session, never from the request
    # Evidence: the quoted answers

  @integration @unimplemented
  Scenario: Sharing a personal board places it in this organization
    Given my Coding agents board "Agent spend", while I am in "Acme"
    When I set it to Organization
    Then it becomes a board of "Acme" with the same widgets, stored in my store project
    And it no longer shows in "Beta"
    And its old address opens the shared board
    When the shared board is later deleted
    Then the old personal address reads "This dashboard was deleted or isn't shared with you."
    # Evidence: the quoted board before and after, and screenshots in both organizations

  @unit @unimplemented
  Scenario: Personal boards end with their owner's account
    Given I have My dashboard and two Coding agents boards
    When my account is erased
    Then my personal boards and their widgets are deleted
    And no other member's personal board changes
    # Evidence: the projection's rows before and after the lw.user.erased event

  # ---- Opening by id, addresses, missing boards (B6, B7, S8; E4, E6) ----
  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: A board's address is where it was made, and never changes
    Given boards made in the library, from each product's "+", and as Project boards of "Shop" in LLM Ops
    Then they open at "/dashboards/<id>", except the Project boards, at "/shop/dashboards/<id>"
    When each is moved to another product
    Then the same address still opens it, not rewritten, in its new home product's chrome
    And any of those addresses with the id of a board I may see opens that board
    # Evidence: the address bar and chrome before and after each move

  @integration
  Scenario: A Project board opens at its org-level address
    Given a Project board owned by "Shop", and a member who reads "Shop"
    When they open "/dashboards/<id>"
    Then the board opens there, the address unchanged, reading "Data from Shop" (owner, 2026-11-23)
    # Evidence: the address bar, and a screenshot

  @integration
  Scenario: A Project board of a project I cannot read is not available at org level
    Given a Project board owned by "Ops" and a member who cannot read "Ops"
    When they open "/dashboards/<id>" or "/shop/dashboards/<id>"
    Then the address stays as typed and the page reads "This dashboard was deleted or isn't shared with you."
    And no response, address or page text names "Ops"
    # Evidence: screenshot plus the network panel of the resolve call

  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: A board's old project address keeps working after a move
    Given an Organization board at "/shop/dashboards/<id>" that was moved to Gateway
    When a member of "Acme" who reads "Shop" opens "/shop/dashboards/<id>"
    Then the board opens at that address in the Gateway sidebar
    # Evidence: the address bar and a screenshot

  @integration @unimplemented
  Scenario: A deleted, hidden or archived board reads as not available
    Given the id of a deleted board, another member's Only me board, or an Organization board of an archived project
    When I open it at "/dashboards/<id>" or "/shop/dashboards/<id>"
    Then I see "This dashboard was deleted or isn't shared with you." and a "Back to Dashboards" button that opens "/dashboards"
    And another member's Only me board reads exactly like a deleted one
    And nothing of the board's name, description or widgets shows
    # Evidence: one screenshot per case

  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: Archiving a project hides the organization boards stored in it
    Given Organization boards homed in Gateway and in LLM Ops, stored in "Ops"
    Then the library row's hover and the board's header name "Ops" as the project that stores it, to members who read "Ops"
    When "Ops" is archived
    Then both boards leave the library and every sidebar, and their addresses read "This dashboard was deleted or isn't shared with you."
    When "Ops" is unarchived
    Then both boards are back where they were, with their widgets
    # Evidence: screenshots of the library and the Gateway sidebar before, during and after, and the quoted list answers

  @integration
  Scenario: A board of another organization is not found by id
    Given a board of another organization
    When I open "/dashboards/<id>" or "/shop/dashboards/<id>" in "Acme", or resolve its id
    Then the answer and the page are the same as for a board that does not exist
    # Evidence: the quoted resolve answer, and a screenshot

  # The board runs in the project it opens in (`InProject`): that project's grants and events.
  @integration
  Scenario: An org-level board opened in another project answers from that project's grants
    Given the organization's Dashboards area is on and an Organization board opens in "Shop"
    When the page names no project
    Then what I may do on it is what my own grants in "Shop" let me do
    And when "Shop" is the page's own project, the page's grants answer, with no read of them
    # Evidence: the quoted grant reads

  @integration
  Scenario: Events from an org-level board are about the project it opens in
    Given the organization's Dashboards area is on and an Organization board opens in "Shop"
    When something I do on it is tracked
    Then that event is about "Shop"
    And the events after it are about the page's own project again, or about no project
    # Evidence: the captured event properties

  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: Editing an org-level board follows its owning project
    Given an Organization board homed in Gateway, owned by "Shop"
    When a member with analytics:update in "Shop" opens "/dashboards/<id>"
    Then "Add a widget" and the widget edit actions are offered, and a rename is saved
    When a member who reads "Ops" but not "Shop" opens it
    Then it opens read-only as AC184 says, with the header "Acme · owned by another project"
    And the server refuses a widget write from them, and the board is unchanged
    # Evidence: screenshots as both members, and the quoted refusal

  # ---- Create (B4, B15; E14, E15) ----
  @integration
  Scenario: Create from the library with a name, product and who can see it
    When I press "New dashboard" in the library
    Then a dialog asks for a name, a product, and who can see it
    And the name is "Untitled dashboard N", N the lowest number no board in that product uses ("Untitled dashboard 2" when 1 exists)
    And the visibility picked when the dialog opens is Organization for Gateway or Governance, Only me for Coding agents, and Project for LLM Ops
    And Project is offered only for LLM Ops, as "Everyone in <project>", Organization as "Everyone in Acme", and Only me with "You can share it later"
    And the picked product's note reads "Lives in <product>. Move it from Dashboards."
    And for Gateway and Governance, and for a Coding agents board shared beyond me, the dialog reads "Stored in <my store project>"
    And my store project is my last-used project where I may create, or with none used yet the first such project by name
    And with no project where I may create, no "New dashboard", "+", Duplicate, "Duplicate to edit" or template add is offered
    When I create it
    Then it opens unsaved at "/dashboards/new" under the name I typed
    When I make its first edit
    Then it is stored homed in that product at the scope I picked, it opens at "/dashboards/<id>", and it is listed in that product's sidebar and in the library
    # Evidence: screenshots of the dialog per product, the quoted create answer, and a screenshot as a member who never opened a project

  @integration
  Scenario: A product's "+" fixes the product and says where the board lives
    When I press "+" in the Gateway sidebar's Dashboards section
    Then the dialog has no product choice and reads "Lives in Gateway. Move it from Dashboards."
    # Evidence: screenshot of the dialog

  @integration
  Scenario: The create dialog refuses an empty name, and Cancel makes nothing
    When the name is empty or only spaces
    Then "Create" is disabled
    When I press Cancel
    Then no board is made and the library is unchanged
    # Evidence: screenshot of the disabled button, and the library before and after

  # Owner, 2026-11-25: Project silently meant the last-used project, with no way to pick another.
  @integration
  Scenario: In the library, a Project board's project is picked under Project
    Given I may create dashboards in "Shop" and "Ops", and "Shop" is my last-used project
    When I press "New dashboard" in the library and Project is picked
    Then a project picker under Project shows "Shop" and offers "Ops" and "Shop"
    When I pick "Ops"
    Then Project reads "Everyone in Ops"
    When I create it
    Then it opens unsaved in "Ops", and its first edit stores it in "Ops" at scope Project
    When I pick Organization or Only me instead
    Then no project picker is shown
    # Evidence: a haven browser screenshot of the dialog with the picker open, and the quoted create

  @integration
  Scenario: A board is never stored in another member's personal project
    Given I am an admin who may create dashboards in "Shop", in my own personal project and in another member's personal project
    When the places to store a new board are listed for me
    Then they offer "Shop" and my own personal project
    And they never offer the other member's personal project

  @integration
  Scenario: A product's "+" inside a project offers no project picker
    Given I am in "Shop"
    When I press "+" in the LLM Ops sidebar's Dashboards section
    Then Project reads "Everyone in Shop" and no project picker is shown
    # Evidence: a haven browser screenshot of the dialog

  @unit @integration
  Scenario: A board outside LLM Ops cannot be Project
    When "boards.create" names home Gateway, or "boards.createAtScope" names home Governance and scope Project
    Then each is refused with "dashboard_home_needs_org_scope" and no board is made
    When "boards.createAtScope" names home Gateway and scope Organization
    Then the board is made homed in Gateway, and the library and "boards.getAll" answer it with that home
    And a create that names no home makes an LLM Ops board
    # Evidence: the quoted tRPC refusals and answers

  @unit
  Scenario: A board made before home products is homed in LLM Ops
    Given boards stored before the home column existed
    Then each reads as homed in LLM Ops, with no backfill: the column's default is "llm-ops"
    And an update that names a home stores it, and a star list carries no home
    # Evidence: the migration's SQL and the repository's answers on memory and Postgres

  @integration
  Scenario: A scope change to Project is refused outside LLM Ops
    Given my Organization board homed in Gateway
    When I send "boards.setScope" to Project
    Then it is refused with "dashboard_home_needs_org_scope", and the board stays Organization
    # Evidence: the quoted tRPC refusal

  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: A board homed outside LLM Ops offers no Project scope
    Given my Organization board homed in Gateway
    When I open its scope control or its sidebar menu's "Scope"
    Then it offers Organization and Only me, and no Project
    # Evidence: screenshots of both menus

  @integration
  Scenario: Nobody without analytics:create anywhere is offered creation
    Given I may create dashboards in no project of "Acme"
    Then the library and every product section offer no "New dashboard" and no "+"
    # Evidence: screenshots of the library and the four sections

  # ---- Move (D3; B12, S3; E16) ----
  @integration
  Scenario: Move an Organization board to Gateway
    Given an Organization board homed in LLM Ops that I may edit
    When I choose "Move to product…" in its library menu
    Then the dialog reads "Pick the product whose sidebar lists "<name>". Old links keep opening it." and offers Cancel, which changes nothing
    When I pick Gateway and confirm
    Then a toast says "Moved "<name>" to Gateway" with "Open"
    And it leaves the LLM Ops sidebar and shows in the Gateway sidebar without a page reload, in the same tab
    And its id, its address and its scope are unchanged
    # Evidence: screenshots of the toast and both sidebars, and the quoted board before and after

  @unit @integration
  Scenario: Only the author can move a Project board out of LLM Ops
    Given a Project board in "Shop"
    When its author moves it to Coding agents
    Then the dialog warns "Coding agents has no projects, so only you will see it until you share it."
    And after the move it is Only me, homed in Coding agents, and still owned by "Shop" in "Acme"
    When another member who may edit in "Shop" opens "Move to product…" on it
    Then the products outside LLM Ops are disabled and the dialog says "Only its author can move a Project board out of LLM Ops."
    And hovering a disabled product says "Only its author can move a Project board out of LLM Ops."
    And the server refuses such a move from them with "dashboard_scope_author_only", and the board is unchanged
    # Evidence: screenshots of both dialogs and the hover, the quoted move answer and the refusal
    # Setting a board's scope is its author's call (setScope); a move that would change it is too.

  @unit @integration
  Scenario: Moving a board changes its home only
    Given my Organization board homed in LLM Ops, owned by "Shop"
    When I send "boards.move" to Gateway
    Then the answer is the board as the library lists it, homed in Gateway, with its id, owner and scope unchanged
    And moving an Only me board out of LLM Ops keeps it Only me, and an Organization board moved back into LLM Ops stays Organization
    # Evidence: the quoted move answer and resolve answer

  @integration
  Scenario: The server refuses a move without edit rights in the owning project
    Given I may only view dashboards in "Shop"
    When I send "boards.move" for a "Shop" board
    Then it is refused with "permission_denied" and its home is unchanged
    And a move named from "Ops" for a "Shop" Organization board is refused with "dashboard_read_only_here"
    And a move of another member's Only me board is refused with "dashboard_not_found"
    # Evidence: the quoted refusals, and the board before and after

  @integration
  Scenario: Move edge cases
    Given boards I may edit
    Then "Move" is disabled while the picked product is the board's current one, marked "Current"
    And moving an Organization board back into LLM Ops keeps it Organization
    And moving an Only me board into LLM Ops keeps it Only me, not Project
    And moving an Only me board out of LLM Ops shows no sharing note and keeps it Only me
    And an Organization board owned by a project I cannot read shows "Move to product…" disabled, saying "You can view this dashboard but not change it."
    And moving My dashboard to Gateway lists it in the Gateway section, and "/shop/dashboards" still opens it
    And a move of my personal board sent by another member is answered as "not found"
    # Evidence: a screenshot per case, and the quoted board after each move

  @integration
  Scenario: Move needs edit rights in the owning project
    Given I may only view dashboards in "Shop"
    Then the library shows "Move to product…" on "Shop" boards disabled, saying "You can view this dashboard but not change it."
    # Evidence: a screenshot of the hover

  # ---- Chart menu (E9) ----
  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: A widget moves to another board of the same product, or to a new one
    Given a widget on a Gateway board, and two other Gateway boards and one LLM Ops board I may edit
    When I open the widget's menu and choose "Move to…"
    Then it lists the two other Gateway boards and "New dashboard", and no LLM Ops board
    When I pick a board
    Then the widget moves there and a toast offers Undo, which puts it back
    When I pick "New dashboard"
    Then a Gateway board named "New dashboard" is made, Organization, and the widget moves there
    And from a Coding agents board it is Only me, from an LLM Ops board in "Shop" it is a Project board of "Shop", and from an LLM Ops board at org level it is Organization: the create dialog's default for the product
    # Evidence: screenshots of the menu, the toast and both boards, and the quoted answers

  # ---- Product sidebars (B11; G13 title rule; E7, E8, E10) ----
  # Owner, 2026-11-23, replacing the approved design's starred group: a board is in the sidebar
  # of its product when I can see it for the project in view, starred or not.
  @integration
  Scenario: No sidebar has a Starred dashboards group
    Given "Dashboards in every product" and "the organization's Dashboards area" are on, and I starred boards before
    When I am in LLM Ops, Gateway, Coding agents, Governance or the Dashboards sidebar
    Then there is no "Starred dashboards" group, and no project's pinned Dashboards section
    And a starred board is listed in its own product's Dashboards section like any other
    And with "Dashboards in every product" off, Gateway, Coding agents and Governance show no Dashboards section
    # Evidence: screenshots of the five sidebars

  @integration
  Scenario: Each product's sidebar lists its own boards
    Given boards homed in each product
    When I am in Coding agents, Gateway or Governance
    Then the sidebar has a "Dashboards" section with that product's boards I may see, in my own order and the rest by name, 8 then "Show N more" and "Show less"
    And its "+" opens the create dialog with that product fixed
    And a board is listed only when its owning project has Dashboards on and I may read it, or it is my personal board
    And a member who can reach Dashboards in no project of "Acme" sees no section
    And the "+" shows when I hold analytics:create in at least one project, an organization admin's own grants included
    And outside LLM Ops it shows only when I also hold analytics:update in the store project, because a board there cannot be Project
    And after "?ff_release_dashboards=off" in this browser there is no section
    And each row shows a lock on Only me boards and a hover title: "Only you can see this", "Shared with <project>" or "Shared with the organization"
    And with no board I can see homed there, the section still shows its heading and "+" with "No dashboards yet", so every product reads alike
    # Evidence: screenshots of the three sidebars, and one per access case

  # Owner, 2026-11-23: "each dashboard name on the side should have the 3 verticle dots on
  # hover for their menu".
  @integration
  Scenario: A sidebar row shows the library's menu on hover
    Given a board listed in a product's Dashboards section
    When I hover its row, or move keyboard focus into it
    Then a "⋮" button shows at the row's right end, and it stays while its menu is open
    And otherwise the row looks as it did, with no "⋮", the row of the board I have open included
    And clicking a row to open its board leaves no "⋮" once the mouse moves away
    And its menu is the library row's, by the same rules: Rename, Move to product…, Duplicate and Delete where I hold analytics:update and analytics:delete in the owning project; no Rename, no Delete and a greyed-out Move where I may only view
    And opening the menu does not open the board
    And Rename edits the name in place in the row, and Enter saves it in the project that owns the board
    # Evidence: haven browser screenshots of a row at rest, hovered and with its menu open, and of
    # the open board's row at rest after a click, light and dark

  # Request from the dashboards team, 2026-11-26: "we should be able to reorganize the order of
  # the dashboards on the sidebar by dragging". The order is each member's own, per organization
  # and product: a section mixes Project, Organization and Only me boards of several projects,
  # so no shared order fits every member, and arranging one's own sidebar needs no edit rights.
  @unit @integration
  Scenario: Drag a board to reorder a product's Dashboards section
    Given the LLM Ops Dashboards section lists My dashboard, "Alpha", "Beta" and "Gamma"
    When I drag "Gamma" above "Alpha"
    Then the section lists My dashboard, "Gamma", "Alpha" and "Beta" at once, and again after a reload
    And My dashboard stays first and cannot be dragged
    And dragging a row and letting go does not open its board
    # Evidence: haven browser screenshots of the section before and after the drag

  @integration
  Scenario: Reorder a product's Dashboards section from the keyboard
    Given the LLM Ops Dashboards section lists My dashboard, "Alpha", "Beta" and "Gamma"
    When I move focus to the "Reorder Gamma" handle, press Space, ArrowUp twice and Space
    Then the section lists My dashboard, "Gamma", "Alpha" and "Beta", and the move is announced
    And Escape while moving puts the board back where it was and saves nothing
    # Evidence: haven browser screenshot with the handle focused

  @integration
  Scenario: A reorder the server refuses puts back the last saved order
    Given my saved LLM Ops order is "Gamma", "Alpha" and "Beta"
    When I move "Beta" above "Gamma" and the save fails
    Then the section lists My dashboard, "Gamma", "Alpha" and "Beta" again with no new read
    And it says "Couldn't save the order of your dashboards"
    And when an earlier save is refused while a later one is still out, the later order stays and shows once it is saved

  @integration
  Scenario: Quick reorders are saved in the order I made them
    Given the LLM Ops Dashboards section lists My dashboard, "Alpha", "Beta" and "Gamma"
    When I move "Gamma" up and then "Alpha" down while the first save is still out
    Then the second order is sent only after the first save is answered
    And the order I made last is the one stored and shown

  @unit
  Scenario: A board my order does not name is listed after the ones it does, by name
    Given my order in LLM Ops names "Beta" then "Alpha"
    When a board "Aardvark" is made in LLM Ops
    Then the section lists My dashboard, "Beta", "Alpha" and then "Aardvark"
    And a board in my order that I can no longer see is skipped

  @unit
  Scenario: Reordering in one project keeps the place of boards listed only in another
    Given my LLM Ops order holds a Project board of "Ops" between two Organization boards
    When I swap the two Organization boards while in "Shop"
    Then the "Ops" board keeps its place between them in my order

  @integration
  Scenario: The sidebar order is stored per member, organization and product
    When I save an order for LLM Ops in "Acme"
    Then the boards.sidebarOrder read answers it to me and to nobody else
    And my Gateway order and my order in another organization are unchanged
    And the write needs only organization:view in "Acme"
    And an order of more than 500 boards, or one naming an id twice, is refused as malformed and stores nothing
    # Evidence: the quoted boards.sidebarOrder and boards.reorderSidebar answers

  # Owner, 2026-11-24: "when I'm on a dashboard page it doesn't really show as selected on the
  # menu", and "why are dashboard menu items smaller and with less padding than other items?"
  @integration
  Scenario: The open board's sidebar row is marked as the page I am on
    Given a board listed in a product's Dashboards section, or pinned in LLM Ops with the library off
    When I open it at "/dashboards/<id>" or at "/shop/dashboards/<id>"
    Then its row, and no other, is marked as the current page, filled as "Agent Testing" is
    And every Dashboards row has the height, padding, text style and colours of the sidebar's own entries
    # Evidence: screenshots of the open board's row beside "Agent Testing", light and dark

  # Owner, 2026-11-25: "I find it weird this 'Browse templates' ... how is it different than
  # 'start from a template'?". A new board is where the templates are.
  @integration
  Scenario: The Dashboards section has no templates entry
    When I am in any product in "Shop"
    Then its Dashboards section has no "Browse templates" row
    And in LLM Ops a new board from its "+" shows every template until it has a widget
    # Evidence: screenshot of the section
  @integration @unimplemented
  Scenario: A long sidebar scrolls with a fade, and its footer stays put
    Given more boards than the window can show
    Then the sidebar's list scrolls, its bottom fades while there is more below, and the footer stays at the bottom
    And the page I am on is scrolled into view
    # Evidence: screenshots at the top and the bottom of the scroll, light and dark

  # G13: one title rule. PR 9698 at 4bdb2e57 showed "Dashboards · Demo projec" clipped.
  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: Every product's Dashboards section has the same title, never clipped
    Given my current project is named "Demo project"
    And a board named "Checkout conversion by model and region, last 90 days"
    When I am in LLM Ops, Coding agents, Gateway or Governance with the sidebar 212px wide
    Then the section's title reads exactly "Dashboards", with no project name, in all four
    And the "+" stays visible at the right of the title
    And the long board name ends with "…" and shows in full on hover
    And every truncated text in the section has an ellipsis and a hover title with the full text
    # Evidence: four screenshots (LLM Ops, Coding agents, Gateway, Governance) at 212px, light and dark, plus one hover

  # ---- Empty board, failures, gates, public surfaces (S1; N7, N8, N9) ----
  # Owner, 2026-11-23: "templates should only be llm ops, not also on the dashboards page".
  @integration
  Scenario: Only an empty LLM Ops board offers templates
    Given an empty LLM Ops board in "Shop" and an empty Gateway board
    When I open the "Shop" board at "/shop/dashboards/<id>", or at "/dashboards/<id>" as its sidebar row does
    Then at either address its "Or start from a template" lists every template, as "/shop/dashboards/templates" does
    And the Gateway board shows no "Or start from a template" at either address, as no Coding agents or Governance board does
    And each still shows its ask bar, its suggested questions and its header's "Add a widget"
    # Evidence: a screenshot of each empty board, the LLM Ops one at both addresses

  @integration @unimplemented
  Scenario: A failed read or write says so, and never reads as deleted
    When the library list, a board's resolve, or a section's list fails
    Then the library and the section say "Couldn't load your dashboards." with "Retry", which loads again
    And the board page shows an error with "Retry", not "This dashboard was deleted or isn't shared with you."
    When a create, move, duplicate or delete fails
    Then the dialog or menu shows the error, and nothing changes
    # Evidence: haven screenshots with the call failed (network blocked), light and dark

  @integration
  Scenario: Dashboards off in every project
    Given release_dashboards is off for every project of "Acme"
    When I open "/dashboards", "/dashboards/<id>" or "/dashboards/templates"
    Then I see the app's not-found page, and the rail and the product switcher have no Dashboards entry
    And on a page with no project the flags are evaluated for the organization
    # Evidence: screenshots and the flag evaluation's target in the network panel

  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: The public dashboards API is unchanged
    Given a Gateway-homed Organization board of "Shop" and my personal board
    Then "/api/v1/dashboards" (`board.rest.ts`) lists and reads the Gateway board for a "Shop" key exactly as before this change, before and after a move
    And "langwatch dashboards" (`sdks/typescript/src/cli/commands/dashboards/`) and the MCP dashboard tools answer as before
    And the personal board is in no API, CLI or MCP answer
    And the one change is that "all" leaves out other members' personal projects, as in ""All projects" leaves out what I may not read"
    # Evidence: the quoted REST answers before and after a move, and the CLI output

  # ---- No project switcher on a board (owner, 2026-11-23; D1, D2) ----
  @integration @unimplemented
  Scenario: Dashboards has no project switcher, and a board says whose data it shows
    Given I open "/dashboards", "/dashboards/templates", or a board at "/dashboards/<id>" or "/shop/dashboards/<id>"
    Then the library and Templates show no project chip, and no board's header offers a project to switch to
    And an LLM Ops Organization board's header reads "Data from <the project in view>", read-only, and the LLM Ops top bar switches that project
    And a Project board's header reads its own project, and a Gateway or Governance board's names none
    And "/shop/dashboards" and its boards draw LLM Ops chrome, with its project chip
    # Evidence: haven browser screenshots of each address, light and dark

  # ---- Release gate per project ----
  @integration
  Scenario: Boards of a project with Dashboards off are not in the organization's area
    Given "Ops" has release_dashboards off
    Then no board owned by "Ops" is listed or resolved by id at org level
    # Evidence: the quoted list and resolve answers

  # ---- Reserved slug (B14) ----
  @unit
  Scenario: "dashboards" is a reserved project slug
    Given "dashboards" is reserved beside "gateway", so minting never gives it to a project
    And a project made while slugs carried no id suffix (October and November 2023) holds "dashboards"
    When the upgrade runs its background step "project:reslug-reserved-dashboards"
    Then that project's slug becomes its name and id token, as minting gives a project today
    And a second run changes nothing, every other project keeps its slug, and with no such project the step does nothing
    # Evidence: the step's report on the first and the second run

  # Until that background step has run, the router gives "/dashboards", "/dashboards/<one segment>"
  # and "/dashboards/curated/<id>" to the organization's area; every deeper address is the project's.
  @integration
  Scenario: A project still holding the dashboards slug keeps its deeper pages
    Given I read a project whose slug is still "dashboards", before "project:reslug-reserved-dashboards" has run
    When I open one of its pages below the area's own addresses, such as "/dashboards/messages/<trace id>", with the area's flag on or off
    Then the page opens in LLM Ops with its project chip, as before this change, and not as a not-found page or the Dashboards area
    And a board of that project at "/dashboards/dashboards/<id>" stays a project board in that project's Dashboards area
    # Evidence: the shell drawing the page with the flag off and on
