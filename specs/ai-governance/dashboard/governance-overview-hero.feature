Feature: The governance overview opens with a hero and nothing else
  As an administrator responsible for AI across the organization
  I want the governance overview to open the way the project home does
  So that the first thing I meet is a way in, not a wall of panels

  The overview used to open with a setup checklist, then with a hero followed
  by every activity-monitor panel: spend, users, anomalies, ingestion-source
  health, the CLI session policy. Each panel read a different router on a
  different grant, so a reader whose plan or role did not include one met an
  error alert before they met the page.

  The panels live on the pages that own them. What is left is the greeting,
  one field, the one action that starts everything (connect a vendor), four
  shortcuts under it, and the two lists that fill once there is something to
  put in them. The page reads nothing of its own, which is why nothing on it
  can fail.

  Background:
    Given organization "acme" has the AI governance feature flag on
    And I hold `governance:view` and `activityMonitor:view` on "acme"

  @integration
  Scenario: The hero leads with adding a source
    Given I also hold `ingestionSources:manage`
    When the overview renders
    Then an "Add source" control is offered above the shortcuts
    And it opens a menu rather than firing straight away
    And it carries the mark of each vendor the menu offers

  # Everything in this section that creates something is an outline control,
  # so the one on the overview cannot be the exception. The filled treatment
  # stays available to the project home, which is not part of this section.

  @integration
  Scenario: The lead action is an outline control rather than a filled one
    Given I also hold `ingestionSources:manage`
    When the overview renders
    Then the "Add source" control carries no accent fill, border or text
    And nothing drawn inside it carries one either
    But it still reads as heavier than the shortcuts beside it
    And it is heavier by surface, mark and caret rather than by colour

  @integration
  Scenario: The source menu names the three vendors an admin arrives with
    Given I also hold `ingestionSources:manage`
    When I open the "Add source" menu
    Then it offers "Anthropic", "OpenAI" and "Microsoft Copilot", in that order
    And nothing else, because the sources tab holds the full catalog
    And picking one opens the sources tab on that vendor's add flow

  @integration
  Scenario: Adding a source is offered only to whoever may add one
    Given I do not hold `ingestionSources:manage`
    When the overview renders
    Then no "Add source" control is offered, because the add flow would refuse me
    And the four shortcuts are offered just the same

  # A shortcut used to read "Add anomaly rule" and point at
  # /governance/inventory?tab=anomaly-rules. Anomaly rules stopped being an
  # inventory tab, so that address degraded to the inventory's default pane
  # and the shortcut quietly delivered the catalog under a rule's name. The
  # test asserted the href and so never saw it. Every shortcut now says what
  # it actually opens.
  @integration
  Scenario: The hero offers four ways in, three to add and one to configure
    When the overview renders
    Then the hero offers "Add department", "Add agent", "Add tool" and "Configure sources", in that order
    And no other shortcut is offered beside them
    And the three that add come first, in the order a surface is set up:
      the group people belong to, the agents it runs, the tools those reach

  # Landing on the right page is not the same as arriving somewhere useful.
  # Two of these shortcuts used to land on the correct page and open nothing,
  # leaving the reader to find the add button themselves, which is the work
  # the shortcut existed to save.

  @integration
  Scenario: Each add shortcut opens the flow that adds the thing it names
    When the overview renders
    Then "Add department" leads to the departments tab of the people page, asking it to open its add flow
    And "Add agent" leads to the agents page ready to add one
    And "Add tool" leads to the catalog tab of the inventory, asking it to open its add flow
    And a shortcut that lands on the right page and opens nothing is a broken shortcut

  @integration
  Scenario: A shortcut leads through to every source the product can pull from
    When the overview renders
    Then a "Configure sources" shortcut leads to the sources tab of the inventory
    And it sits last in the row, because it configures rather than adds
    And it is offered whether or not I may add a source, because that tab reads without the grant
    And it is how a reader whose vendor is not one of the three on the pill reaches the rest

  @integration
  Scenario: No shortcut points at a tab the page would not honour
    When the overview renders
    Then every shortcut carrying a tab in its address names a tab that page has
    And a shortcut naming a tab that no longer exists is a broken shortcut,
      because the page degrades it to the default pane rather than refusing it

  @integration
  Scenario: The field offers Langy to whoever may ask
    Given I can ask Langy
    When the overview renders
    Then the field offers to ask Langy
    But when I cannot ask Langy
    Then the field offers search without Langy
    And the same four ways in are offered

  @integration
  Scenario: Insights and recent activity wait under the hero
    Given I turned the sample panels off
    When the overview renders
    Then a section named "Insights" is shown under the hero
    And it says nothing is to report until sources are pulling
    And a section named "Recent activity" is shown beside it
    And it says recent screens will show up there

  # The overview starts empty. Both lists fill only after samples are enabled.

  @integration
  Scenario: The two lists fill when samples are enabled
    Given I have enabled sample data
    When the overview renders
    Then both lists carry sample rows rather than their empty lines
    And each list says "sample" beside its own name

  # The samples show the ANATOMY of a row, not just its subject. A reader who
  # turns them on is asking what this page becomes, and a stack of loose
  # sentences answers a different question from a list they can scan.

  @integration
  Scenario: An insight row reads as a severity, a headline and a date
    Given the sample panels are on
    When the insights list renders
    Then each row leads with a severity badge in the palette that severity carries
    And the three severities offered are a warning, one worth a look and good news
    And the headline follows on one line, cut with an ellipsis rather than wrapped
    And the date sits at the right of the row, muted and small

  @integration
  Scenario: A recent-activity row reads as a mark, a name and a kind
    Given the sample panels are on
    When the recent activity list renders
    Then each row leads with the mark of the screen it goes back to
    And the name follows as body text, the whole row leading to that screen
    And the kind of thing it was sits at the right of the row as a neutral chip
    And the chip keeps its width as the column narrows, the name giving way instead
    And no row leads to a screen this organization is not offered

  @integration
  Scenario: The overview carries the section's sample toggle
    When the overview renders
    Then the sample toggle sits at the top right of the page header
    And pressing it takes the sample lines off both lists
    And that same choice is the one every other governance page reads

  @integration
  Scenario: Setting up insights is offered only where the screen exists
    Given the Insights screen is offered to "acme"
    When the overview renders
    Then a "Set up insights" button leads to the insights screen
    But when the Insights screen is not offered to "acme"
    Then no such button is drawn, because it would lead nowhere

  # The project home lights its ask field with a moving mesh. The governance
  # home asks for the same thing in the same words, and opening it on flat page
  # white read as an unfinished copy of a screen the reader had already seen
  # working. It now stands on the same ground.

  @integration
  Scenario: The hero stands on the same lit ground as the project home
    When the overview renders
    Then the hero sits on the moving ground the project home's field sits on
    And that ground is hidden from assistive technology
    And it takes no clicks, so the field and the pill above it stay reachable

  # The two screens sit one click apart in the rail and ask for the same thing
  # in the same words. The governance field was set wider than the project
  # home one, so moving between them resized the field under the reader, which
  # read as two different controls rather than one.

  @integration
  Scenario: The field is the width the project home sets its own field to
    When the overview renders
    Then the ask field is no wider than the project home ask field
    And the pill and the shortcuts under it keep to that same width
    But the two lists below stay wider than the field
    And they stay wider because their rows carry a badge, a headline and a date
      across two columns, which the field width would leave unscannable

  @integration
  Scenario: The overview renders no error alert and issues no spend read
    Given every activity-monitor read would be refused because the plan does not include it
    When the overview renders
    Then no error is shown on the page
    And no spend, activity, anomaly or ingestion-source read is issued at all
    And the hero still renders
