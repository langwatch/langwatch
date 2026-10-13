Feature: A retention scope write is authorised at the door, inside the organisation the caller names
  The three scope procedures (set, preview removal, remove) may carry the organisation the page
  sits in; when one does not, the server reads it from the target the door approved, as on main
  (ruling RETENTION-ORG, Alex, 2026-10-09). The door asks the permission the target needs before the handler runs: organization:manage
  on an organisation, team:manage on a team, project:update on a project, as on main. Data
  retention then asks only what depends on its own rows: that the target sits in that
  organisation, read from project's and organization's rows through their shares (ruling LIN-1,
  Alex, 2026-10-08; R40).

  Background:
    Given an organisation "acme" with a team "platform" and a project "web-app" under that team
    And project's table places "web-app" under "platform", and organization's places "platform" in "acme"

  @unit
  Scenario: Each scope procedure declares the target's permission at the door
    Given the data retention tRPC declaration
    When its scope procedures are mounted
    Then each chooses its permission by the scope type it is given
    And an organisation asks organization:manage, a team team:manage and a project project:update, each on the target
    And none of them is left for the service to authorise

  @unit
  Scenario: A caller without the target's permission is refused before data retention runs
    Given a caller who may update project "web-app" but may not manage "acme"
    When that caller sets an organisation-level traces retention for "acme" through the door
    Then the door refuses the request as forbidden, naming organization:manage
    And data retention is never called

  @unit
  Scenario: A project member sets their own project's retention
    Given a caller who may update project "web-app" but may not manage "acme"
    When that caller sets a project-level traces retention for "web-app" naming "acme"
    Then the door asks project:update on "web-app"
    And the override is written, anchored to "acme"

  @unit
  Scenario: A team or project of another organisation is refused as not found
    Given an organisation "globex" whose team "ops" holds a project "billing"
    When an administrator of "acme" sets, previews or removes an override for "ops" or "billing" naming "acme"
    Then each request is refused as a scope target that was not found
    And no retention policy is written or removed

  @unit
  Scenario: An organisation scope must be the organisation the caller names
    When an administrator sets an organisation-level retention for "globex" naming "acme"
    Then the request is refused as a scope target that was not found

  @unit
  Scenario: The plan gate reads the organisation the caller names
    Given "acme" is on the free plan
    When an administrator of "acme" sets a team-level retention for "platform" naming "acme"
    Then the request is refused because the plan does not unlock retention overrides
    And the named organisation is taken as given, with no directory of teams or projects read

  @unit
  Scenario: A team with no project yet takes a team-level rule
    Given a team "research" in "acme" that holds no project
    When an administrator of "acme" sets a team-level retention for "research" naming "acme"
    Then the override is written, anchored to "acme"

  @integration
  Scenario: The settings page sends its organisation with every scope write
    Given the retention settings page for project "web-app" in "acme"
    When the reader previews the removal of an override and removes it
    Then the preview and every removal carry "acme" as their organisation
    And a save from the page names its organisation, though the procedure would accept one without it

  @unit
  Scenario: A scope write without its organisation is plan-gated on the target's own organisation, as on main
    Given "acme" is on the free plan
    When an administrator sets a team-level retention for "platform" naming no organisation
    Then the request is refused because the plan does not unlock retention overrides
    And the plan gate asked about "acme", where the team's own row places "platform"

  @unit
  Scenario: A scope write without its organisation acts on the target's own organisation
    Given a caller who may update project "web-app" but may not manage "acme"
    When that caller sets, previews and removes a project-level retention for "web-app" naming no organisation
    Then the door asks project:update on "web-app" each time
    And the override is written anchored to "acme", then removed

  @unit
  Scenario: A scope write without its organisation whose target has no row is refused as not found
    When an administrator sets, previews or removes an override for a team no row places, naming no organisation
    Then each request is refused as a scope target that was not found
    And no retention policy is written or removed
