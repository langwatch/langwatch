Feature: The governance overview opens with a hero
  As an administrator responsible for AI across the organization
  I want the governance overview to open the way the project home does
  So that the first thing I meet is a way in, not a checklist of what is missing

  The overview used to open with a setup checklist and a page-wide error
  whenever one of the checklist's reads was refused. It now opens with a
  greeting, one field (the command palette mounted inline, the same field the
  project home carries), one lead action (connect a vendor) and a short row of
  shortcuts.

  Every read the page still issues answers for its own panel. A panel the plan
  does not include is simply not shown; it is not a page error.

  Background:
    Given organization "acme" has the AI governance feature flag on
    And I hold `governance:view` and `activityMonitor:view` on "acme"

  @integration
  Scenario: The hero leads with the ingestion-source pill only for whoever can manage sources
    Given I also hold `ingestionSources:manage`
    When the overview renders
    Then the hero offers a prominent "Add an ingestion source" pill with a caret
    And the setup checklist is not shown
    When I only hold `ingestionSources:view`
    Then no pill is offered in its place

  @integration
  Scenario: Picking a vendor from the pill opens the inventory on that vendor
    Given I also hold `ingestionSources:manage`
    And the overview renders
    When I open the pill and pick "OpenAI"
    Then I am taken to the inventory Sources tab with the OpenAI source type ready to add
    When I open the pill and pick "All sources"
    Then I am taken to the inventory Sources tab

  @integration
  Scenario: The shortcut chips lead to the rules and to the people
    Given I can ask Langy
    When the overview renders
    Then "Add an anomaly rule" links to the inventory anomaly rules tab
    And "Add people" links to the people page
    And the field offers to ask Langy
    But when I cannot ask Langy
    Then the same two chips are offered
    And the field offers search without Langy

  @integration
  Scenario: A plan that does not include anomaly rules raises no page error
    Given the anomaly rules read is refused because the plan does not include it
    When the overview renders
    Then no error is shown on the page
    And the hero still renders
