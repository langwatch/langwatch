@integration
Feature: Project slug placeholder redirect
  As a user who clicks a link with an unresolved project slug
  (for example a URL of the form "/[project]/evaluations" copied from docs,
  templates, browser history, or an email link where [project] was never filled in)
  I want to land on the same section of my currently selected project
  So I keep my intended destination instead of being bounced to the project home

  Background:
    Given I am logged in
    And I have access to project "test-project"
    And "test-project" is my last selected project

  # Placeholder slug — [project] is a literal "[project]" segment, not a real slug
  Scenario: Visiting a placeholder project URL preserves the sub-path
    When I navigate directly to "/[project]/evaluations"
    Then I should be redirected to "/test-project/evaluations"
    And I should see the evaluations page

  Scenario: Visiting a placeholder project URL for simulations preserves the sub-path
    When I navigate directly to "/[project]/simulations"
    Then I should be redirected to "/test-project/simulations"

  Scenario: Visiting a placeholder project URL with a nested sub-path preserves the full tail
    When I navigate directly to "/[project]/annotations/my-queue"
    Then I should be redirected to "/test-project/annotations/my-queue"

  Scenario: Visiting a placeholder project URL preserves query string
    When I navigate directly to "/[project]/messages?topics=greeting"
    Then I should be redirected to "/test-project/messages?topics=greeting"

  # Unknown / stale project slug
  Scenario: Visiting a URL with an unknown project slug redirects to the same section of my last project
    When I navigate directly to "/unknown-project-slug/evaluations"
    Then I should be redirected to "/test-project/evaluations"

  # Bare placeholder (no tail) still goes to project home
  Scenario: Bare placeholder redirects to last selected project home
    When I navigate directly to "/[project]"
    Then I should be redirected to "/test-project"
