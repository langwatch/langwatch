# Implementation:
#   apps/ui/src/ui/sections/ui-page.tsx
# Plan:
#   dev/docs/plans/install-composition-review-2026-09-03.md

Feature: One page helper composes every routed page
  Every route file in the browser application declares its pages through one
  helper, so the wrapping order every route depends on is stated once rather
  than in each file.

  There is no settings-layout wrapper in this helper. The settings sidebar
  comes from `NavigationShell`, mounted once for every matched page by the
  application's chrome route: `resolveShellRoute`'s `isSettingsRoute` is a
  path test (`/settings`, `/ops`), not a per-page opt-in. A page that also
  wrapped itself in a settings layout rendered that sidebar twice, nested —
  see specs/navigation/settings-shell-v2.feature for the one sidebar that
  chrome now owns alone.

  Background:
    Given a screen module, a host component and a page policy

  @unit
  Scenario: The host sits outside the guard
    Given the page asks for a host and a grant
    When the page loader resolves
    Then the mounted tree is host, then guard, then screen

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
