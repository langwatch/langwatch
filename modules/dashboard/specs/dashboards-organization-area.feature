Feature: Organization-wide Dashboards area
  # Sources: tasks#1211 comment 2026-11-19; the approved design; ADR-002 (amended);
  # product decisions D1-D5 of 2026-11-21.
  #
  # Spec first (ADR-002, amended): every scenario is @unimplemented until the slice that builds
  # it binds a test and drops the tag. The other tags name the level it binds at.
  # @q1-all-projects rests on product decision D1, @q3-author-only on D3.
  # "The organization's Dashboards area" is the flag release_dashboards_organization_area (ADR-002,
  # decision 6); "Dashboards in every product" is release_dashboards_in_every_product, which
  # governs only the other products' sidebar sections. Both need release_dashboards.
  # A "# Next PR" line marks a scenario this PR (S0: the library, the starred group and the
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
    And the LLM Ops sidebar's Dashboards section lists my pins, at most 7, its "+" makes a board at once, and it has no "Browse templates"
    And the Dashboards sidebar at "/shop/dashboards" is the one dashboards-v1 AC3 describes
    And "/shop/dashboards" lands on my My dashboard of "Shop", as today
    And the project switcher on an Organization board at "/shop/dashboards/<id>" lands on "/ops/dashboards"
    And a not-available page shows AC183's text and no "Back to Dashboards"
    And a board moved to Gateway while the flag was on is listed in LLM Ops again
    And a Project board its author moved out while the flag was on lists in LLM Ops as Only me, for its author alone
    And my personal boards are not shown anywhere, and none is deleted
    And "Coding agents" replaces "Me", and "/me" addresses redirect to "/coding-agents"
    # Evidence: one screenshot per address and sidebar above with the flag off, each paired
    # with the base commit's screenshot of the same address

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

  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: An org-level board draws its home product's chrome, with no project chip
    Given an Organization board homed in Gateway
    When I open "/dashboards/<id>"
    Then the top bar shows the organization control and no project chip
    And "Gateway" is highlighted in the switcher and the icon rail, and the Gateway sidebar shows
    When a member whose seat cannot reach Gateway opens the same address
    Then it opens in the Dashboards chrome, with no project chip
    # Evidence: haven browser screenshots of /dashboards/<id> as both members

  # Next PR: "All projects" at the organization level (ADR-002, decision 9; D1).
  @integration @q1-all-projects @unimplemented
  Scenario: An LLM Ops board or a From LangWatch board at org level
    Given an Organization board homed in LLM Ops, and my last-used project "Shop"
    When I open "/dashboards/<id>" or "/dashboards/curated/<template id>"
    Then the LLM Ops sidebar shows, its links pointing at "Shop", and LLM Ops is highlighted
    And the top bar shows the organization control and no project chip
    And the board's own chip reads "All projects" and its widgets read every project I may read
    When I have no last-used project
    Then the links point at the first project I read, by name, and with none the Dashboards sidebar shows
    When I open a Gateway-homed Organization board at "/shop/dashboards/<id>"
    Then the Gateway sidebar shows with no project chip, and the board's chip reads "Shop"
    # Evidence: haven screenshots of each case, sidebar link targets hovered, and the run's params
    # Chrome as the approved design (the last-used project). Data "All projects" by D1 (21 Nov,
    # newer than the approved design's "reads its project's scope"). Top bar: the 1211 comment.

  @integration
  Scenario: The Dashboards sidebar at org level
    When I open "/dashboards"
    Then the Dashboards sidebar lists "All dashboards" (current), "Templates" and my "Starred dashboards", and nothing else besides Quick Search
    And "Templates" opens "/dashboards/templates"
    # Evidence: haven browser screenshot of the sidebar, and the address after the click

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
    And one group, "LLM Ops · <count>", lists the From LangWatch boards first, each marked "Read-only", then boards with no project, then the rest by project
    And each row names who sees it: the project's name, "Organization", or "Only me"
    And each row names its owner, "You" for mine, else its author's name
    And an Organization board opens at "/dashboards/<id>", a Project board at its project's address
    # Evidence: haven browser screenshots of the library, light and dark

  @integration
  Scenario: A board made in the library is made at its scope in one write
    When I press "New dashboard" in the library and create a board with a name and who can see it
    Then it is stored in my store project at that scope, in one write
    And a Project board opens at its project's address, an Only me or Organization one at "/dashboards/<id>"
    And a seat that may create dashboards there but not update them is refused an Only me or Organization board, and nothing is written
    # Evidence: the quoted boards.create and boards.createAtScope answers, and the refusal

  @integration
  Scenario: Delete, rename, star and duplicate from the library
    When I delete a board I may delete and confirm
    Then it is deleted in its own project and a toast says ""<name>" deleted"
    And an Organization board of a project I cannot read offers no Delete
    When I star a row
    Then it is starred in the project it opens in, and Unstar removes the star
    When I rename a board I may edit
    Then Enter saves the name in place in its own project and says "Dashboard renamed", and Escape saves nothing
    And a board of a project where I may not edit offers no Rename
    When I duplicate a board
    Then the copy, "<name> copy", is stored in my store project at the board's scope and opens
    # Evidence: the quoted delete, update, star and create answers, and screenshots of the toasts

  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: The library lists every board I may see, grouped by product
    Given boards homed in LLM Ops, Coding agents, Gateway and Governance
    When I open "/dashboards"
    Then the header reads "Dashboards" with "Every dashboard you can see, by product."
    And each product I can reach that has at least one board or From LangWatch board has a group headed "<Product> · <count>", counting both, in the order LLM Ops, Coding agents, Gateway, Governance
    And a product with neither has no group
    And LLM Ops lists its From LangWatch boards first, each marked "Read-only"
    And within a group, boards with no project come first, then by project name, then by board name
    And each row names who sees it: the project's name, "Organization", or "Only me" with a lock
    And each row names its owner, "You" for mine
    And a From LangWatch row shows "Read-only" as who sees it and "LangWatch" as owner
    And a project name too long for its column, such as "Checkout conversion and refunds EU", ends with "…" and shows in full on hover
    # Evidence: haven browser screenshots of the library, light and dark, plus one hover

  @integration
  Scenario: The library leaves out what I may not see
    Given another member's Only me board, a Project board of a project I cannot read,
      and boards of a project where Dashboards is off
    When I open "/dashboards"
    Then none of them is listed
    And an Organization board whose project I cannot read is listed with no project named
    And an Organization board of an archived project is not listed
    # Evidence: the quoted boards.listInOrganization answer for that member

  @integration
  Scenario: A long group shows 8 boards, then "Show N more" and "Show less"
    Given 11 boards homed in LLM Ops
    Then the LLM Ops group shows its From LangWatch boards and 8 boards, and a "Show 3 more" that opens the rest in place
    And then it reads "Show less", which folds the group back to 8
    And a group of 8 boards or fewer offers neither
    # Evidence: haven browser screenshots before and after each click

  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: A long group stays open or folded after a reload
    Given 11 boards homed in LLM Ops
    When I press "Show 3 more" and reload the library
    Then the LLM Ops group still lists all 11 boards and reads "Show less"
    When I press "Show less" and reload the library
    Then the group shows 8 and a "Show 3 more" again
    # Evidence: haven browser screenshots after each reload

  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: A library row's menu offers what I may do
    Given my Organization board homed in Gateway, owned by "Shop", where I hold analytics:update and analytics:delete
    Then its menu offers Star, Rename, Move to product…, Duplicate and Delete
    And Rename edits the name in place: Enter or leaving the field saves it and says "Dashboard renamed", Escape cancels
    And a From LangWatch row offers Star (or Unstar) and "Duplicate to edit", and no Move
    And a starred row's menu offers Unstar, "Move up" and "Move down", which change my star order everywhere
    And My dashboard offers "Move to product…", and shows "Delete" disabled, saying "Your default dashboard can't be deleted"
    And the server refuses a delete of My dashboard with "dashboard_default_not_deletable"
    # The hover on My dashboard's Delete is an addition: the approved design disables it with no hover
    And starring a row from the library lists it in the Gateway sidebar's starred group without a page reload, in the same tab
    # Evidence: haven browser screenshots of each menu and hover, and of the sidebar after the star

  # Next PR: home products (ADR-002, decision 8).
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
    When I try to delete the last board I can see in a product in this organization, counting Project, Organization, Only me and personal boards and not From LangWatch ones
    Then nothing is deleted and a toast says "You can't delete your last dashboard"
    And the same delete sent to the server is refused with "dashboard_last_in_product"
    # Evidence: the quoted create and delete answers and the refusals, and screenshots of the toasts and pages

  # Next PR: From LangWatch boards always list today, so the library is never empty yet.
  @integration @unimplemented
  Scenario: An empty library
    Given I may see no board and no From LangWatch board
    Then "/dashboards" reads "No dashboards yet" and "Make one for any product. It shows in that product's sidebar."
    And it offers "New dashboard" when I may create
    # Evidence: haven browser screenshot

  # ---- Data at org level vs project view (1211; D1) ----
  # Next PR: "All projects" at the organization level (ADR-002, decision 9; D1).
  @unit @integration @q1-all-projects @unimplemented
  Scenario: An org-level board reads every project I may read
    Given an Organization board whose widget stores no projects
    When I open it at "/dashboards/<id>"
    Then the widget's run asks for projects "all"
    And {dashboard_context_projects:Array(String)} is bound to ["Ops", "Shop"] in stable order
    And the chip reads "All projects", and the card line reads "Projects: All projects"
    # Evidence: the run's params, and a screenshot of the chip and the card line

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

  @unit @integration @unimplemented
  Scenario: The project view of the same board is filtered to that project
    Given the same Organization board
    When I pick "Shop" in its chip, or open "/shop/dashboards/<id>"
    Then it is the same board and the run reads "Shop" alone, with the card line "Project: Shop"
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

  # Next PR: "All projects" at the organization level (ADR-002, decision 9; D1).
  @integration @q1-all-projects @unimplemented
  Scenario: A From LangWatch board opens at the organization level
    When I open a From LangWatch board from the library
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

  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: The LLM Ops section in a project lists the same boards, filtered
    Given LLM Ops-homed boards owned by "Shop" and by "Ops", some Project, some Organization, one starred
    When I am in LLM Ops in "Shop"
    Then its Dashboards section shows My dashboard, then the "Shop" boards I may see and every Organization board homed in LLM Ops, not starred, by name
    And then my starred LLM Ops boards in my order, then the From LangWatch boards I have not starred
    And it lists no Project board of "Ops" and no board homed in another product
    And every board it lists is also in the library
    # Evidence: haven browser screenshot of the section next to the library's LLM Ops group

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
    And both earlier ones still exist, listed in LLM Ops as "My dashboard · Shop" and "My dashboard · Ops", Only me
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
  Scenario: A Project board's org-level address redirects to its project
    Given a Project board owned by "Shop", and a member who reads "Shop"
    When they open "/dashboards/<id>"
    Then they land on "/shop/dashboards/<id>" with the project chip showing "Shop"
    # Evidence: the address after the redirect, and a screenshot

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
  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
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
    Then a toast says "Dashboard created", it opens at "/dashboards/<id>" (an LLM Ops Project board at its project's address), it is listed in that product's sidebar and in the library, and its scope is the one I picked
    # Evidence: screenshots of the dialog per product and of the toast, the quoted create answer, and a screenshot as a member who never opened a project

  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: A product's "+" fixes the product and says where the board lives
    When I press "+" in the Gateway sidebar's Dashboards section
    Then the dialog has no product choice and reads "Lives in Gateway. Move it from Dashboards."
    # Evidence: screenshot of the dialog

  # Next PR: today an empty name marks the field and makes nothing; "Create" is not disabled.
  @integration @unimplemented
  Scenario: The create dialog refuses an empty name, and Cancel makes nothing
    When the name is empty or only spaces
    Then "Create" is disabled
    When I press Cancel
    Then no board is made and the library is unchanged
    # Evidence: screenshot of the disabled button, and the library before and after

  # Next PR: home products (ADR-002, decision 8).
  @unit @unimplemented
  Scenario: A board outside LLM Ops cannot be Project
    When a create names home Gateway and scope Project
    Then it is refused with "dashboard_home_needs_org_scope" and no board is made
    # Evidence: the quoted tRPC refusal

  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: A board homed outside LLM Ops offers no Project scope
    Given my Organization board homed in Gateway
    When I open its scope control or its sidebar menu's "Scope"
    Then it offers Organization and Only me, and no Project
    And a scope change to Project sent to the server is refused with "dashboard_home_needs_org_scope"
    # Evidence: screenshots of both menus, and the quoted refusal

  @integration @unimplemented
  Scenario: Nobody without analytics:create anywhere is offered creation
    Given I may create dashboards in no project of "Acme"
    Then the library and every product section offer no "New dashboard" and no "+"
    # Evidence: screenshots of the library and the four sections

  # ---- Move (D3; B12, S3; E16) ----
  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: Move an Organization board to Gateway
    Given an Organization board homed in LLM Ops that I may edit
    When I choose "Move to product…" in its library menu
    Then the dialog reads "Pick the product whose sidebar lists "<name>". Old links keep opening it." and offers Cancel, which changes nothing
    When I pick Gateway and confirm
    Then a toast says "Moved "<name>" to Gateway" with "Open"
    And it leaves the LLM Ops sidebar and shows in the Gateway sidebar without a page reload, in the same tab
    And its id, its address and its scope are unchanged
    # Evidence: screenshots of the toast and both sidebars, and the quoted board before and after

  # Next PR: home products (ADR-002, decision 8).
  @unit @integration @q3-author-only @unimplemented
  Scenario: Only the author can move a Project board out of LLM Ops
    Given a Project board in "Shop"
    When its author moves it to Coding agents
    Then the dialog warns "Coding agents has no projects, so only you will see it until you share it."
    And after the move its scope is Only me, and it stays in "Acme"
    When another member opens "Move to product…" on it
    Then the products outside LLM Ops are disabled, and hovering one says "Only its author can change who sees it."
    And the server refuses such a move from them with "dashboard_scope_author_only", and the board is unchanged
    # Evidence: screenshots of both dialogs and the hover, and the quoted refusal

  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: Move edge cases
    Given boards I may edit
    Then "Move" is disabled while the picked product is the board's current one, marked "Current"
    And moving an Organization board back into LLM Ops keeps it Organization
    And moving an Only me board into LLM Ops keeps it Only me, not Project
    And moving an Only me board out of LLM Ops shows no sharing note and keeps it Only me
    And an Organization board owned by a project I cannot read shows "Move to product…" disabled, saying "You can view this dashboard but not change it."
    And moving my Coding agents board "Agent spend" to Gateway keeps it personal and Only me: it lists in Gateway in "Acme" and in "Beta", and no other member can list it
    And moving My dashboard to Gateway lists it in the Gateway section, and "/shop/dashboards" still opens it
    And a move of my personal board sent by another member is answered as "not found"
    And moving "Agent spend" to LLM Ops keeps it personal and Only me: it lists in the LLM Ops section in every project and in the library's LLM Ops group, and still follows me to "Beta"
    # Evidence: a screenshot per case, and the quoted board after each move

  # Next PR: home products (ADR-002, decision 8).
  @unit @integration @unimplemented
  Scenario: Move needs edit rights in the owning project
    Given I may only view dashboards in "Shop"
    Then the library shows "Move to product…" on "Shop" boards disabled, saying "You can view this dashboard but not change it."
    And a move request is refused and the home product is unchanged
    # Evidence: the quoted refusal, a screenshot of the hover, and the board before and after

  # Next PR: home products (ADR-002, decision 8).
  @unit @unimplemented
  Scenario: A moved board's home survives a rebuild of its events
    When a board is moved to Governance and the home projection is rebuilt from its events
    Then the board is still listed in the Governance sidebar
    And a board never moved is listed in LLM Ops
    # Evidence: the list answer before and after the rebuild

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
  # The approved design's starred group in the other products; home products split it later.
  @integration
  Scenario: Gateway, Coding agents and Governance list my starred dashboards
    Given "Dashboards in every product" and "the organization's Dashboards area" are on
    When I am in Gateway, Coding agents or Governance
    Then the sidebar has a "Starred dashboards" group, 7 of my stars then "All starred (N)", which opens the library
    And no project's Dashboards section
    And with either off there is no such group
    # Evidence: screenshots of the three sidebars

  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: Each product's sidebar lists its own boards
    Given boards homed in each product
    When I am in Coding agents, Gateway or Governance
    Then the sidebar has a "Dashboards" section with that product's boards I may see, not starred, by name, 8 then "Show N more" and "Show less"
    And then my starred boards of that product, in my order
    And its "+" opens the create dialog with that product fixed
    And a board is listed only when its owning project has Dashboards on and I may read it, or it is my personal board
    And a member who can reach Dashboards in no project of "Acme" sees no section
    And the "+" shows when I hold analytics:create in at least one project, an organization admin's own grants included
    And after "?ff_release_dashboards=off" in this browser there is no section
    And each row shows a lock on Only me boards and a hover title: "Only you can see this", "Shared with <project>" or "Shared with the organization"
    And with no board I can see homed there and no From LangWatch board, there is no section, and the library's "New dashboard" makes the product's first board
    # Evidence: screenshots of the three sidebars, and one per access case

  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: Every sidebar lists my stars from other products
    Given I starred 9 boards homed in LLM Ops and one homed in Gateway
    When I am in Gateway
    Then a "Starred dashboards" group lists 7 of the LLM Ops ones in my order, then "All starred (9)", which opens the library
    And the Gateway one is in the Dashboards section, not in this group
    And the rows are plain links with no menu and no unstar
    And the group folds and unfolds, and the Settings sidebar has no such group
    # Evidence: screenshots of the Gateway and Settings sidebars, folded and unfolded

  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: The LLM Ops section ends with Browse templates
    When I am in LLM Ops in "Shop"
    Then the last row of its Dashboards section is "Browse templates", which opens "/shop/dashboards/templates"
    # Evidence: screenshot of the section and the address after the click

  @integration @unimplemented
  Scenario: A long sidebar scrolls with a fade, and its footer stays put
    Given more boards and stars than the window can show
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
  # Next PR: home products (ADR-002, decision 8).
  @integration @unimplemented
  Scenario: An empty board offers only its product's templates
    Given an empty LLM Ops board in "Shop", an empty LLM Ops board at org level, and an empty Gateway board
    Then the "Shop" board's "Or start from a template" lists the From LangWatch boards of LLM Ops and links to "/shop/dashboards/templates"
    And the org-level one links to "/dashboards/templates"
    And the Gateway board offers no template
    # Evidence: a screenshot of each empty board

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

  # ---- Project switcher ----
  @integration @unimplemented
  Scenario: The project switcher on boards in a project view
    Given I am on "/shop/dashboards/<id>"
    When the board is a Project board and I switch to "Ops"
    Then I land on "/ops/dashboards"
    When the board is an LLM Ops Organization board or My dashboard and I switch to "Ops"
    Then I land on "/ops/dashboards/<id>", the same board reading "Ops"
    # Evidence: the address after each switch, and screenshots

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
