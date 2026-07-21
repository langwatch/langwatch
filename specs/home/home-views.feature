@unit
Feature: Adaptive home views
  As a user
  I want the home page arranged for the situation my project is in
  So that the first screen engages my own work instead of showing every
  user the same lobby

  One skeleton — greeting, announcement banners, resources footer — with
  the middle modules composed per view. Resolution is data-driven, from
  the project's state and the user's own recent activity, balancing three
  jobs: show useful information first, surface signals, and nudge toward
  the adjacent features exactly where they build on the work already
  happening — never as a tour.

  Background:
    Given I am on the home page

  Scenario: A project with no traces gets the first-run view
    Given the project has never received a trace
    When the home page resolves its view
    Then the page shows the onboarding checklist and the banners
    And no stat row or recent-items section is shown

  Scenario: An activated project gets the briefing view
    Given the project has received traces
    And the user's recent activity is mixed or thin
    When the home page resolves its view
    Then the page shows banners, onboarding progress, the traces overview, and recent items

  Scenario: A user living in one pillar gets that persona's view
    Given the project has received traces
    And at least three of the user's recent items from the last two weeks are evaluations or datasets
    And they make up at least half of everything the user touched lately
    When the home page resolves its view
    Then the evals view is shown
    And recent evaluations and datasets appear before other recent items
    And no recent items are hidden — the rest of the platform stays in reach

  Scenario: Persona views carry a focus line with cross-feature nudges
    Given the evals view is active
    Then one quiet line under the greeting names what the view centres on
    And each nudge beside it is a concrete next action in an adjacent feature that builds on that work
    And the first-run and briefing views carry no focus line

  Scenario: The triage view leads with health
    Given the triage view is active
    Then the traces overview appears before anything else
    And the announcement banners are demoted below recent items
    And the onboarding checklist is not shown
    # Triage has no automatic trigger yet — it needs an error-spike signal
    # the backend does not expose today. Reachable via the dev switcher.

  Scenario: The resolved view is cached so the page never assembles in front of the user
    Given the user resolved a view within the last fifteen minutes
    When they return to the home page
    Then the cached view renders immediately while the data revalidates in the background
    And if the fresh resolution disagrees, the middle modules crossfade to the new composition as one motion
    And under prefers-reduced-motion the change is instant, without animation

  Scenario: Developers can preview any view
    Given the app is running a development build
    When I use the view switcher next to the greeting
    Then I can pin the page to any view, or return it to automatic resolution
    And the switcher is never rendered in production builds
