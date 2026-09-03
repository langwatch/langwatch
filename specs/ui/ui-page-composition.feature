# Implementation:
#   apps/ui/src/ui/sections/ui-page.tsx
# Plan:
#   dev/docs/plans/install-composition-review-2026-09-03.md

Feature: One page helper composes every routed page
  Every route file in the browser application declares its pages through one
  helper, so the wrapping order the settings pages depend on is stated once
  rather than in each file.

  Background:
    Given a screen module, a host component and a page policy

  @unit
  Scenario: The host sits outside the settings chrome, which sits outside the guard
    Given the page asks for a host, the settings layout and a grant
    When the page loader resolves
    Then the mounted tree is host, then settings layout, then guard, then screen

  @unit
  Scenario: A key with neither grant nor flag mounts no guard
    Given the page asks for a host and nothing else
    When the page loader resolves
    Then the screen is wrapped in the host and nothing else

  @unit
  Scenario: A flag alone still mounts the guard
    Given the page asks for a feature flag and no grant
    When the page loader resolves
    Then the guard is mounted around the screen
