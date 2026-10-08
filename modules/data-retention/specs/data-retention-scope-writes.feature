Feature: A retention scope write is authorised at the door, inside the organisation the caller names
  The three scope procedures (set, preview removal, remove) carry the organisation the page sits
  in. The door asks the permission the target needs before the handler runs: organization:manage
  on an organisation, team:manage on a team, project:update on a project, as on main. Data
  retention then asks only what depends on its own rows: that the target sits in that
  organisation, through its fold of project facts (ruling LIN-1, Alex, 2026-10-08).

  Background:
    Given an organisation "acme" with a team "platform" and a project "web-app" under that team
    And data retention has folded "web-app" under "platform" in "acme"

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
    And no directory of teams or projects is read to find the organisation

  @unit
  Scenario: A team with no project folded yet is refused as not found
    Given a team "research" in "acme" with no project folded under it
    When an administrator of "acme" sets a team-level retention for "research" naming "acme"
    Then the request is refused as a scope target that was not found

  @integration
  Scenario: The settings page sends its organisation with every scope write
    Given the retention settings page for project "web-app" in "acme"
    When the reader previews the removal of an override and removes it
    Then the preview and every removal carry "acme" as their organisation
    And a save cannot be sent without its organisation, since the procedure's input requires it
