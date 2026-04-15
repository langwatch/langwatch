Feature: Experiment slug deduplication

  When saving experiments, the slug is derived from the experiment name.
  If two experiments in the same project generate the same slug, the system
  must deduplicate by appending a numeric suffix to avoid a unique constraint
  violation on (projectId, slug).

  @regression @integration
  Scenario: New experiment gets deduplicated slug when slug conflicts with existing experiment
    Given an experiment exists in the project with slug "my-experiment"
    When a new experiment is saved with a name that generates slug "my-experiment"
    Then the new experiment is created with slug "my-experiment-2"

  @regression @integration
  Scenario: Updating an existing experiment does not trigger slug deduplication against itself
    Given an experiment exists in the project with slug "my-experiment"
    When that same experiment is updated with the same name
    Then the experiment retains slug "my-experiment"

  @regression @integration
  Scenario: Multiple slug conflicts increment the suffix
    Given experiments exist in the project with slugs "my-experiment" and "my-experiment-2"
    When a new experiment is saved with a name that generates slug "my-experiment"
    Then the new experiment is created with slug "my-experiment-3"

  @regression @integration
  Scenario: Slug with no conflict returns unchanged
    Given no experiment exists in the project with the target slug
    When a new experiment is saved
    Then the slug is used as-is without a numeric suffix

  @regression @integration
  Scenario: Unrelated slug sharing the same prefix is not treated as a conflict
    Given an experiment exists with slug "my-exp-extended"
    When a new experiment is saved with a name that generates slug "my-exp"
    Then the new experiment is created with slug "my-exp" without a suffix
