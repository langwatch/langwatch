Feature: The People page is two tabs, People and Departments
  The People page under AI Governance answers two questions an admin asks
  together: who is using AI through the connected sources, and which
  department each person belongs to. It opens on one table of people and
  keeps the department list, its add-department dialog and the assignment
  guide on a second tab, so neither crowds the other.

  Background:
    Given the AI Governance product is enabled for the organization
    And alice is an organization admin
    And sam is a delegated viewer holding governance:view and activityMonitor:view

  # ---------------------------------------------------------------------------
  # ONE TABLE. The screen used to carry two: a spend ranking read from the
  # activity monitor, and a separate "people the providers see" list read from
  # the identity feed. They are two measurements of the same population — the
  # gateway metered the money, the pull sources named the humans — and a reader
  # asking "who is spending" had to hold both in their head and join them by
  # eye. The page joins them instead.
  #
  # The join is by identifier, and it is deliberately timid, because deciding
  # that two identifiers are the same human is the match engine's job and not
  # this screen's. A spend row joins a discovered person only when exactly one
  # non-erased discovered person carries that identifier. Two providers naming
  # the same address stay two rows (governance-people-discovery.feature), and
  # the money stays on its own row rather than being shown twice.
  #
  # The controls follow the section rulebook,
  # specs/ai-governance/dashboard/governance-ui-controls.feature: one filter row
  # under the header holding time frame, department and sort; the page's actions
  # top-right; sample data behind the same toggle every governance page has.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The default tab is People
    When sam opens the People page with no tab in the address
    Then the People tab is selected
    And the table of people is requested
    And no tab parameter is written to the address

  @integration
  Scenario: The Departments tab is addressable
    When sam opens the People page with tab set to departments
    Then the Departments tab is selected
    And the department list is requested

  # ── One table ─────────────────────────────────────────────────────────────

  @integration
  Scenario: The People table renders each person with spend, requests and last activity
    Given one person used AI through a connected source in the window
    When sam opens the People page
    Then the table lists that person by name
    And the row shows their spend in dollars, their request count and when they were last active
    And the row leads to that person's detail page

  @integration
  Scenario: A person matching an organization member shows that member's department
    Given a member of the organization is assigned to the Engineering department
    And that member used AI through a connected source in the window
    When sam opens the People page
    Then the person's row shows Engineering as the department

  @integration
  Scenario: A most-used chip links to its source only when a source matches
    Given one person whose most-used target is the name of a connected source
    And one person whose most-used target matches no source
    When sam opens the People page
    Then the first person's chip links to that source's inventory page
    And the second person's chip is plain text

  @integration
  Scenario: A person the providers named with no spend behind them is on the same table
    Given a discovered person no spend row names
    When sam opens the People page
    Then that person is a row on the same table as the spenders
    And their spend, requests and last active read as not measured
    # The two lists were one population all along. A person the pull sources
    # named but the gateway never metered is not a second kind of thing.

  @integration
  Scenario: A spend row and the discovered person naming the same identifier are one row
    Given a spend row for an address
    And exactly one discovered person carrying that same address
    When sam opens the People page
    Then the table holds one row for them, carrying both the spend and the provider
    # The join the page is allowed to make: one claimant, one row.

  @integration
  Scenario: Every row says whether we know the account behind it
    Given a discovered person linked to a member
    And a discovered person linked to nobody
    And a person who has been erased
    When sam opens the People page
    Then their rows read as matched, unmatched and erased in turn

  # ── The controls ──────────────────────────────────────────────────────────

  @integration
  Scenario: Time frame, department and sort are chips in one row under the header
    When sam opens the People page
    Then a single filter row under the header holds the time frame, the department and the sort
    And no filter is rendered anywhere else on the page
    And the page renders no native select element

  @integration
  Scenario: The chosen time frame, department and sort are part of the address
    When sam picks a time frame, a department and a sort
    Then each choice is written to the address
    And opening that address again reads back the same choices

  @integration
  Scenario: A time frame longer than the spend read accepts is asked for at the read's limit
    Given the reader picks the longest time frame
    When the table is requested
    Then the window asked for is the longest the spend read accepts
    # The spend read takes a window in days and refuses more than a year. The
    # chip still offers two years, because clamping is honest where a missing
    # option is not — the page shows the frame it actually read.

  @integration
  Scenario: The department chip filters the table to that department
    Given people in two departments
    When sam picks one of them from the department chip
    Then only that department's people are listed

  # ── Header actions ────────────────────────────────────────────────────────

  @integration
  Scenario: The page's actions sit top-right in the header
    When alice opens the People page
    Then the sample-data toggle, Run match pass and Add department sit at the top right of the header
    And each is rendered at the small size
    And Add department is solid, in the section's orange
    And Run match pass is outline
    And the sample-data toggle is ghost at rest and subtle once pressed, never solid
    # Add department is the solid one because a department is the only thing on
    # this screen that exists because somebody made it: a person arrives here
    # because a provider named them, and Run match pass recomputes over what is
    # already there. Orange rather than the default grey, so it matches the
    # Inventory page's Add tool. Rulebook: governance-ui-controls.feature.

  @integration
  Scenario: Run match pass is a header action, not a panel's own button
    When alice presses Run match pass
    Then the proof pass runs
    # Same contract as governance-people-screen.feature; only the button moved.

  # ── Sample data ───────────────────────────────────────────────────────────

  @integration
  Scenario: A page with nobody on it opens on sample people
    Given every read has answered and none of them holds a row
    When sam opens the People page
    Then sample people fill the table
    And the banner says nothing on the page is real

  @integration
  Scenario: Turning sample data off on an empty page says nobody was active
    Given every read has answered and none of them holds a row
    When sam turns the sample data off
    Then the People tab says no one has used AI through a connected source in the window

  @integration
  Scenario: Sample data steps aside once real people arrive
    Given one person used AI through a connected source in the window
    When sam opens the People page
    Then the sample people are off screen
    And the toggle still offers to show them

  @integration
  Scenario: Enterprise-locked activity shows a quiet line, not an alert
    Given the organization's plan does not include the activity monitor
    When sam opens the People page
    Then the People tab shows a muted line saying the Enterprise plan is needed
    And no spend request is sent
    And no error alert is shown
    And a server refusal naming the plan renders the same muted line

  @integration
  Scenario: Sample mode shows no error alerts, not even the plan refusal
    Given the organization's plan does not include the activity monitor
    And a read on the page failed
    When sam turns the sample data on
    Then no error alert is shown
    And the muted Enterprise plan line is gone
    And the sample people are on screen
    # A screen advertising invented figures must not also report that a read of
    # the real ones failed: the reader cannot act on either half of that.

  @integration
  Scenario: Nobody active in the window
    Given nobody used AI through a connected source in the window
    And the reader has turned the sample data off
    When sam opens the People page
    Then the People tab says no one has used AI through a connected source in the window

  # ── Departments tab ───────────────────────────────────────────────────────

  @integration
  Scenario: Adding a department is a dialog, not a box wedged into the header
    When alice presses Add department
    Then a dialog offers a text field for the name and a primary Create
    And creating one closes the dialog and adds it to the list

  @integration
  Scenario: The Departments tab offers no controls to a viewer without the manage grant
    When sam opens the People page with tab set to departments
    Then there is no control to create a department
    And the page names the governance:manage grant

  @integration
  Scenario: Assigning a department to a person uses the app's own select
    Given a person the page knows the account for
    When alice opens the assign-department action on their row
    Then the department is chosen from the app's own select component
    And no native select element exists
    # A department list is unbounded — a menu pill reading "Department · …"
    # cannot hold a hundred of them, which is the case the rulebook reserves
    # the app's own select for.
