Feature: The People page is two tabs, People and Departments
  The People page under AI Governance answers two questions an admin asks
  together: who is using AI through the connected sources, and which
  department each person belongs to. It opens on a summary strip, then one
  table of people, and keeps the department list and the assignment guide on
  a second tab, so neither crowds the other. Creating a department is the
  section's ordinary right-side drawer, reachable from the header and by
  address.

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
  # under the header holding department and sort; the page's actions top-right;
  # sample data behind the same toggle every governance page has.
  #
  # NO TIME FRAME. The row used to open with one, and it did not correlate to
  # what the table shows. Half these rows come from the identity feed, which
  # carries no window at all, so narrowing the frame moved the metered people
  # and left everyone a provider merely named exactly where they were — a
  # control that appeared to filter the table and filtered half of it. The
  # spend read still needs a window and has no unbounded mode, so it is asked
  # for a fixed year and the page states that year in words. A window nobody
  # can change is at least a window nobody has to guess at.
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
  Scenario: Department and sort are chips in one row under the header
    When sam opens the People page
    Then a single filter row under the header holds the department and the sort
    And no time frame is offered anywhere on the page
    And no filter is rendered anywhere else on the page
    And the page renders no native select element

  @integration
  Scenario: The chosen department and sort are part of the address
    When sam picks a department and a sort
    Then each choice is written to the address
    And opening that address again reads back the same choices

  @integration
  Scenario: The spend window is fixed and stated, not chosen
    Given an address left over from before the time frame was removed
    When sam opens the People page at it
    Then the spend read is asked for a year regardless of what the address names
    And the Spend and Requests headings say the figures cover the last 12 months
    And no control offers to change that window
    # The window is stated on the two columns it is true of and nowhere else.
    # It used to be one half of a paragraph under the table, which said it to a
    # reader who was looking at the figures rather than at the last line of the
    # card, and said it beside a second sentence about the sort.

  @integration
  Scenario: The page says how far the sort reaches
    When sam opens the sort control
    Then it says the ranking reaches the people with measured spend
    And it says the people a connected source named but nothing measured follow, most recently seen first
    # The other half of what the time frame got wrong, and it is still on
    # screen. The sort chip drives the spend read, so it ranks the rows that
    # read returned; everybody a provider merely named keeps their own order
    # however the chip is set. Ranking both halves needs a read that measures
    # both, which is not this screen's to build — so the limit is made visible
    # rather than hidden, because a reader who sets "Sort · Last active" and
    # watches a third of the rows stay put would otherwise conclude the control
    # is broken. It is said in the sort menu, on the control it is true of,
    # rather than in a paragraph under the table: the reader who needs it is
    # the one reaching for the control. The chip is not hidden and the table is
    # not narrowed to rankable rows: either would trade an honest limitation
    # for a worse one.

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
    And Add department is the house header button, outline with a leading plus glyph
    And it is the only outlined control in that row
    And Run match pass is ghost
    And the sample-data toggle is ghost at rest and subtle once pressed, never solid
    And nothing in that row is solid, in the section's orange or in any other colour
    # Add department is the marked-out one because a department is the only
    # thing on this screen that exists because somebody made it: a person
    # arrives here because a provider named them, and Run match pass recomputes
    # over what is already there. It is marked out by the outline rather than
    # by a fill — the section has no filled buttons at all any more.
    # Rulebook: governance-ui-controls.feature.

  @integration
  Scenario: Run match pass is a header action, not a panel's own button
    When alice presses Run match pass
    Then the proof pass runs
    # Same contract as governance-people-screen.feature; only the button moved.

  # ── Sample data ───────────────────────────────────────────────────────────

  @integration
  Scenario: An empty People page shows samples only when requested
    Given every read has answered and none of them holds a row
    And sam has enabled sample data
    When sam opens the People page
    Then sample people fill the table
    And the banner says nothing on the page is real

  @integration
  Scenario: Turning sample data off on an empty page accounts for both halves of the table
    Given every read has answered and none of them holds a row
    When sam turns the sample data off
    Then the People tab says no one has used AI through a connected source and no connected source has named anyone
    # Both halves or it is a half-truth. The sentence used to name only the
    # time frame the reader had picked, which was true of the metered half and
    # said nothing at all about the people a provider named.

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
  Scenario: Nobody metered and nobody named
    Given nobody used AI through a connected source
    And no connected source has named anybody
    And the reader has turned the sample data off
    When sam opens the People page
    Then the People tab says no one has used AI through a connected source and no connected source has named anyone

  # ── The summary strip ─────────────────────────────────────────────────────
  #
  # Above the tabs, so it answers "what is on this page" before the reader has
  # picked one. It is the section's shared strip, not a second one built here:
  # every figure is counted off the rows the table already holds, so the
  # summary and the table can never disagree, and a reader has no way to tell
  # which of two disagreeing counts is the wrong one.
  #
  # A figure nothing measured reads as an em dash. Never a zero: an
  # organization that has not been counted must not be reported as an
  # organization with nobody in it.

  @integration
  Scenario: The People page opens with a summary strip above its tabs
    Given two people used AI through a connected source
    And a connected source named a third person nothing metered
    And the organization has two departments, one of which a member is assigned to
    When sam opens the People page
    Then the strip says three people
    And it says two departments
    And it says two people are unmatched
    And it says two people are without a department

  @integration
  Scenario: The summary strip sits above the tabs
    When sam opens the People page
    Then the strip comes before the tab list

  @integration
  Scenario: A summary figure the page cannot measure reads as an em dash
    Given the department list has not answered yet
    When sam opens the People page
    Then the department figure reads as an em dash rather than zero
    And the people figure still reports what the answered reads hold

  @integration
  Scenario: In sample mode the summary strip counts the sample rows
    Given the reader has turned the sample data on
    When sam opens the People page
    Then the strip counts the invented people and the invented departments
    And the banner saying nothing is real comes before the strip

  # ── Creating a department ─────────────────────────────────────────────────
  #
  # A drawer, not a modal, because a drawer is what this app has: URL-routed,
  # mounted once by the drawer shell, deep-linkable from a paste and closed by
  # the browser's own back button. The page never mounts it — it navigates to
  # it (dev/docs/best_practices/drawers.md).
  #
  # ONE FIELD, and that is the model rather than a shortcut. A Department
  # stores an identifier, the organization it belongs to, a name, its two
  # timestamps and the moment it was archived. Nothing else is a person's to
  # set at creation: there is no description, no parent department, no cost
  # centre and no owner. If the model grows one, the drawer grows a field for
  # it in the same change.

  @integration
  Scenario: Adding a department opens the create-department drawer
    When alice presses Add department
    Then the page navigates to the create-department drawer
    And the page itself mounts no dialog for it

  @integration
  Scenario: The create-department drawer collects every field the department model has
    When alice opens the create-department drawer
    Then it offers a named field for the department name and a Create action
    And it offers no field the department record does not store

  @integration
  Scenario: Creating a department from the drawer records it and closes
    Given alice has the create-department drawer open
    When she names it and presses Create
    Then the name is recorded without its surrounding spaces
    And the drawer closes
    And the department list is read again

  @integration
  Scenario: A department with no name is refused at the field
    Given alice has the create-department drawer open
    When she presses Create with the name empty
    Then the refusal is shown beside the name field
    And nothing is sent to the server
    # A rejected submission belongs next to the field that caused it. A toast
    # makes the reader hunt for what to change and is gone by the time they
    # find it.

  @integration
  Scenario: A viewer who reaches the create-department drawer is told which grant it needs
    When sam opens the create-department drawer by address
    Then the drawer names the governance:manage grant
    And it offers no name field and no Create action

  @integration
  Scenario: The departments address can ask for the create-department drawer
    When alice opens the People page with tab set to departments and add set to 1
    Then the Departments tab is selected
    And the page navigates to the create-department drawer

  @integration
  Scenario: The request to add a department leaves the address once the drawer has it
    Given the address names the departments tab, the add request and the open drawer
    When alice opens the People page at it
    Then the add request is taken out of the address
    And the tab and the open drawer stay in it
    And no second drawer is asked for

  @integration
  Scenario: A viewer without the manage grant is not offered the create-department drawer
    When sam opens the People page with tab set to departments and add set to 1
    Then the add request is taken out of the address
    And no drawer is asked for

  # ── Departments tab ───────────────────────────────────────────────────────
  #
  # ONE TABLE HERE TOO. The tab used to stack two lists: the departments the
  # organization created, and a separate panel headed "departments the providers
  # see" holding the names the connected directories use. Both list departments,
  # both were on screen at once, and on a tenant where the two agree the reader
  # was shown "Engineering" twice with a paragraph between them explaining why.
  #
  # They are one table. A row a directory named carries a badge saying which
  # provider named it, and that badge is the entire distinction — no second
  # heading, no explanatory paragraph. The difference the two tables were
  # protecting is still real and still enforced: only a row with a `Department`
  # record behind it is offered Rename and Archive, because only a record can be
  # renamed or archived.

  @integration
  Scenario: A department the organization created and one a directory names are one row
    Given the organization created a department named Engineering
    And a connected directory files people under Engineering too
    When sam opens the Departments tab
    Then Engineering is one row, not two
    And that row carries a badge naming the provider whose directory used it
    # Two rows reading the same word, differing in nothing the reader can see,
    # is the confusion the second table caused. One department, one row.
    #
    # "The same" means the trimmed name, compared exactly. That is not this
    # screen's choice: both paths that land directory department text on a
    # `Department` — the SCIM push and the daily directory pull — trim it and
    # resolve it through `resolveByNameOrCreate`, which matches case-sensitively
    # behind a unique index on the active name. The table matches the predicate
    # the writes use, so the next scenario follows from it.

  @unit
  Scenario: A directory spelling that differs in case is a different department
    Given the organization created a department named Engineering
    And a connected directory files people under engineering in lower case
    When sam opens the Departments tab
    Then they are two rows
    And only the one the organization created is offered Rename and Archive
    # Because the backend genuinely keeps them two departments: the directory's
    # spelling does not resolve to the record, it CREATES a second one, and the
    # two attribute spend separately. Folding them into one row here would tell
    # the reader their spend lands in one place while it lands in two, and would
    # leave one real department unmanageable from this screen. If the product
    # wants case-insensitive departments, the fix belongs in
    # `resolveByNameOrCreate`, where the rows are made — not in this table.

  @integration
  Scenario: A department only a directory named carries its provider and no row actions
    Given a connected directory files people under a department the organization never created
    When alice opens the Departments tab
    Then that department is a row on the same table
    And it carries a badge naming the provider
    And it is offered neither Rename nor Archive
    # There is no record to rename and nothing to archive. The badge says where
    # the name came from; the missing menu says what can be done about it.

  @integration
  Scenario: A department no directory named reports no headcount rather than zero
    Given the organization created a department no connected directory names
    When sam opens the Departments tab
    Then its headcount reads as an em dash rather than zero
    And the column says the figure counts the people a source named
    # The headcount counts the people the directories filed under the name, not
    # the members an administrator assigned. A zero would report a department
    # empty when it may hold half the company. The column label is load-bearing
    # for the same reason: an em dash means "not measured" only to a reader who
    # is told what was being measured, and to anyone else a dash beside a
    # department they know has people in it reads as a defect.

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
