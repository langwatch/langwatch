Feature: Limit dialog shows where org usage comes from
  As a user who hit an org-wide plan limit
  I want to see which projects and resources make up the usage
  So that a count like "4 / 3" that exceeds what I see in my current project makes sense

  # Plan limits count resources across every project in the org, so the dialog's
  # "current usage" can look wrong from inside one project. Below the usage the
  # dialog lists the limited resources grouped by project as small gray badges,
  # each linking to the resource, so the source of the limit is clear. Icons come
  # from the standard feature-icon source, rendered gray here.

  @integration
  Scenario: The limit dialog groups the counted resources by project
    Given my organization is over its datasets limit across more than one project
    When the upgrade-required dialog opens for the datasets limit
    Then below the current usage I see each project's name
    And under each project the datasets in it appear as small gray badges with an icon

  @integration
  Scenario: A breakdown badge links to its resource
    Given the limit dialog is open with a per-project breakdown
    When I click a dataset badge
    Then I am taken to that dataset in its project

  @integration @unimplemented
  Scenario: The breakdown covers workflows and prompts
    Given my organization is over its workflows or prompts limit
    When the upgrade-required dialog opens for that limit
    Then the limited resources are grouped by project as gray badges that link to each one

  @integration @unimplemented
  Scenario: Limits without listable resources show no breakdown
    Given my organization is over a member or team limit
    When the upgrade-required dialog opens
    Then the dialog shows the usage without a per-project resource breakdown
