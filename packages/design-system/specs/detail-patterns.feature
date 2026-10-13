Feature: Reusable entity detail patterns
  @integration
  Scenario: A detail drawer names its entity and context
    Given an open drawer with a kind, title and metadata
    Then its accessible name is the entity title
    And the kind and metadata are visible

  @integration
  Scenario: Summary values preserve content and explain absence
    Given summary rows with empty values, zero and a chip
    Then empty values read as an em dash
    And zero and the chip remain visible in a description list

  @integration
  Scenario: Resource rows show identity and provenance together
    Given a resource with an icon, status, description and metadata
    Then its name, status and provenance are visible together

  @integration
  Scenario: Activity is grouped by local day and sorted newest first
    Given unsorted events across today, yesterday and an earlier day
    Then the timeline groups them by local calendar day
    And events are newest first with their supplied icons

  @integration
  Scenario: An empty timeline explains its state
    Given a timeline with no entries
    Then its supplied empty state is visible without empty day groups

  @integration
  Scenario: Relative activity times expose the exact instant
    Given an activity with a relative time
    When the reader focuses its time
    Then the exact ISO instant and Unix milliseconds are available
