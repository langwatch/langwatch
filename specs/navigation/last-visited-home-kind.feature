Feature: Navigation — the lastVisitedHomeKind marker writes only on real change

  Visiting a project page remembers "project" as the preferred home kind in the
  `lastVisitedHomeKind` localStorage key, so the next bare `/` visit lands on
  the project home instead of the personal one.

  The write must be guarded: usehooks-ts broadcasts a synchronous storage event
  on every `setItem`, and every mounted subscriber of the key re-renders on
  every broadcast. An unguarded write on each effect pass of
  `useOrganizationTeamProject` re-broadcast on every org/project refetch, and
  during a route transition that fan-out compounded with other render-loop
  defects past React's 50-nested-update clamp — wedging navigation entirely
  (React error #185). These scenarios pin the guard: write once on a genuine
  first visit, stay silent otherwise.

  Background:
    Given a signed-in user with access to project "acme-app"

  @bdd @ui @navigation @last-visited-home-kind @integration @regression
  Scenario: A first project visit writes the home marker exactly once
    Given no home-kind preference is stored
    When the user lands on "/acme-app/traces"
    Then the resolving hook instance writes "lastVisitedHomeKind" once with "project"
    # Sibling instances mounted in the same commit may repeat the write before
    # the broadcast reaches their closures; those writes are idempotent and the
    # identical value makes every subscriber bail out after its first re-render.
    And each mounted subscriber of the key re-renders exactly once

  @bdd @ui @navigation @last-visited-home-kind @integration @regression
  Scenario: A repeat visit must not re-broadcast a storage event
    Given "lastVisitedHomeKind" already stores "project"
    When the user lands on "/acme-app/traces"
    Then no storage write happens
    And no subscriber re-renders

  @bdd @ui @navigation @last-visited-home-kind @integration @regression
  Scenario: Visiting /messages is not a project-home visit
    Given "lastVisitedHomeKind" already stores "personal"
    When the user lands on "/messages", whose path segment is a reserved word rather than a project slug
    Then the stored preference stays "personal" and nothing is written

  @bdd @ui @navigation @last-visited-home-kind @integration @regression
  Scenario: A resolved-but-not-addressed project is not a project visit
    Given the hook resolves an ambient project while the URL names no project
    When the user lands on "/me"
    Then nothing is written, because only a project named in the address bar counts as a visit
